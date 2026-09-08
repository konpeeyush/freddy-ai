import type { ClientTool } from "@workspace/api"

import {
  cancelIfDependsOn,
  cancelSequence,
  currentStep,
  isAskTool,
  isCancelTool,
  isReservedToolName,
  pinnedInput,
  sequenceIdForStartTool,
  sequenceTools,
  startSequence,
} from "./sequences"

/*
 * Tools the host page defines and runs.
 *
 * The server has no registry of these — a definition is sent with every
 * request and exists only for that turn. So this map is the source of truth
 * for both halves: the definitions that go up, and the handlers that answer
 * the calls that come back.
 *
 * Deliberately module-level rather than React state. Registration happens on
 * the host page, usually before the widget has mounted, and a tool must not
 * be lost when the panel unmounts mid-conversation.
 */

/** How long a handler may take before the turn is answered with an error. */
export const HANDLER_TIMEOUT_MS = 30_000

export type ToolHandler = (
  input: Record<string, unknown>
) => unknown | Promise<unknown>

export type ToolDefinition = ClientTool & { handler: ToolHandler }

const tools = new Map<string, ToolDefinition>()

/** Names that would collide with the wire format or confuse the model. */
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * Registers a tool the page will execute.
 *
 * ```ts
 * FreddyChat.registerTool({
 *   name: "getCartTotal",
 *   description: "The total value of the visitor's cart right now.",
 *   inputSchema: { type: "object", properties: {} },
 *   handler: () => ({ total: cart.total, items: cart.count }),
 * })
 * ```
 *
 * Returns false (and warns) rather than throwing: a malformed tool on a
 * customer's page should cost that tool, not the whole widget.
 */
export function registerTool(definition: ToolDefinition): boolean {
  if (isReservedToolName(definition?.name)) {
    // The sequence machinery exposes tools of its own. A page tool shadowing
    // one would break the flow it is part of, silently.
    console.warn(
      `[tools] "${definition.name}" is reserved by the sequence machinery`
    )
    return false
  }
  if (!definition?.name || !NAME_PATTERN.test(definition.name)) {
    console.warn(
      `[tools] invalid tool name ${JSON.stringify(definition?.name)} — must ` +
        `start with a letter or underscore and contain only letters, digits ` +
        `and underscores`
    )
    return false
  }
  if (typeof definition.handler !== "function") {
    console.warn(`[tools] tool "${definition.name}" has no handler function`)
    return false
  }
  if (!definition.description) {
    console.warn(
      `[tools] tool "${definition.name}" has no description — the model has ` +
        `nothing to decide from and will rarely call it`
    )
    return false
  }

  tools.set(definition.name, definition)
  return true
}

export function registerTools(definitions: ToolDefinition[]): number {
  return definitions.filter(registerTool).length
}

export function unregisterTool(name: string): boolean {
  // A flow mid-run that needs this tool cannot finish without it, and is
  // better abandoned here than stranded on a step it can never complete.
  cancelIfDependsOn(name)
  return tools.delete(name)
}

/**
 * The definitions to send upstream — handlers stripped, they don't serialise.
 *
 * Passed through the sequence layer on the way out. With no flow running that
 * adds an entry point per sequence and changes nothing else; with one running
 * it narrows the list to the step being waited on, which is what makes the
 * ordering enforced rather than merely requested. See `./sequences`.
 */
export function toolDefinitions(): ClientTool[] {
  const page = [...tools.values()].map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }))
  return sequenceTools(page)
}

export function hasTool(name: string): boolean {
  return tools.has(name)
}

/*
 * Tool drift.
 *
 * The tool set here is not fixed the way a server-side one is — the page can
 * register and unregister at any moment, including mid-conversation. That is
 * the point of the design, but it means a transcript can contain a call to a
 * tool that no longer exists, or one whose schema has since changed.
 *
 * Mirrors `fingerprintTools` / `detectToolDrift` from the SDK, which work on
 * server-side `ToolSet`s rather than on the wire shape used here.
 */

/** A stable digest of each tool's contract, for comparison across turns. */
export function fingerprint(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { name, description, inputSchema } of tools.values()) {
    out[name] = JSON.stringify({ description, inputSchema })
  }
  return out
}

/** What changed between two fingerprints. */
export function drift(
  current: Record<string, string>,
  baseline: Record<string, string>
): { added: string[]; removed: string[]; changed: string[] } {
  const has = (o: Record<string, string>, k: string) =>
    Object.prototype.hasOwnProperty.call(o, k)

  const added = Object.keys(current).filter((k) => !has(baseline, k))
  const removed = Object.keys(baseline).filter((k) => !has(current, k))
  const changed = Object.keys(current).filter(
    (k) => has(baseline, k) && current[k] !== baseline[k]
  )
  return { added, removed, changed }
}

/**
 * Runs a tool and always produces an answer.
 *
 * A call that never comes back leaves the model with a dangling tool call,
 * which the provider rejects on the next request — so a handler that throws,
 * hangs, or does not exist still resolves, as an error the model can relay.
 */
/*
 * Required arguments the model did not supply.
 *
 * The server used to catch this: a tool built with `tool()` validated its
 * input against a Zod schema before `execute` ran. A page-defined tool has no
 * such gate — the schema is JSON Schema sent for the model's benefit, and
 * providers drop the parts they cannot express — so the handler is the first
 * thing to see the arguments, and it sees whatever arrived.
 *
 * Left alone, a missing field reaches the handler as `undefined` and gets
 * coerced into something plausible: `getWeather` looked up the empty string
 * and reported that it could not find that city, which reads to the visitor
 * as a broken tool rather than a question the model forgot to ask.
 *
 * Only `required` is enforced. Types are not: JSON Schema here is guidance to
 * the model rather than a contract, and rejecting a number-shaped string
 * would fail turns that would otherwise have worked.
 */
function missingRequired(
  schema: Record<string, unknown> | undefined,
  input: Record<string, unknown>
): string[] {
  const required = schema?.required
  if (!Array.isArray(required)) return []

  return required.filter((key): key is string => {
    if (typeof key !== "string") return false
    const value = input[key]
    // An empty string counts as absent: it is what a model produces when it
    // knows a field is expected but has nothing to put in it.
    return (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "")
    )
  })
}

export async function runTool(
  name: string,
  input: unknown
): Promise<{ output?: unknown; errorText?: string }> {
  /*
   * The sequence machinery's own tools, answered here rather than by a
   * handler — they have no page-side implementation, they only move the flow
   * along. Handled before the registry lookup because they are deliberately
   * not in it.
   */
  const startId = sequenceIdForStartTool(name)
  if (startId) {
    const { started, reason } = startSequence(startId, hasTool)
    return started
      ? { output: { ok: true, note: "Flow started. Carry out the first step." } }
      : {
          errorText:
            `That flow cannot run: ${reason}. Help the visitor directly ` +
            `instead, and do not try to start it again.`,
        }
  }

  if (isCancelTool(name)) {
    cancelSequence()
    return { output: { ok: true, note: "Flow abandoned. Answer them normally." } }
  }

  if (isAskTool(name)) {
    /*
     * Does nothing on purpose: the question travels as the call's argument
     * and the chat loop renders it. Answering here just ends the round so the
     * visitor can type. The step deliberately does not advance — the field is
     * still uncaptured.
     *
     * Note this bypasses the required-argument check below, deliberately. A
     * model that called this without a question has still asked to wait, and
     * refusing the call would spend the turn arguing about a tool the visitor
     * cannot see instead of letting them answer.
     */
    return {
      output: { ok: true, note: "Asked. Wait for the visitor's reply." },
    }
  }

  const step = currentStep()
  if (step?.kind === "ask" && isReservedToolName(name)) {
    // Answered by advance(), which owns writing the captured value — the
    // field name comes from the step rather than from the model.
    return { output: { ok: true, note: "Recorded. Move on to the next step." } }
  }

  const definition = tools.get(name)
  if (!definition) {
    return { errorText: `The tool "${name}" is not available on this page.` }
  }

  /*
   * Arguments a running flow pins from earlier answers win over the model's.
   * Applied before the required-fields check, so a value the flow already
   * holds satisfies it rather than sending the model back to ask again.
   */
  const args = pinnedInput(input)
  const missing = missingRequired(definition.inputSchema, args)
  if (missing.length > 0) {
    /*
     * Answered rather than run. The model reads this and asks the visitor,
     * which is what it should have done instead of calling — and the handler
     * never spends a request on arguments it cannot use.
     */
    return {
      errorText:
        `The tool "${name}" needs ${missing.map((m) => `\`${m}\``).join(", ")}, ` +
        `which ${missing.length === 1 ? "was" : "were"} not provided. Ask the ` +
        `visitor for ${missing.length === 1 ? "it" : "them"} rather than guessing.`,
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const output = await Promise.race([
      Promise.resolve(
        definition.handler(args)
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${HANDLER_TIMEOUT_MS}ms`)),
          HANDLER_TIMEOUT_MS
        )
      }),
    ])
    return { output: output ?? { ok: true } }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.warn(`[tools] "${name}" failed:`, cause)
    return { errorText: `The tool "${name}" failed: ${message}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
