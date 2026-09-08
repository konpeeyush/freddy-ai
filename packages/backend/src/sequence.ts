import { generateObject } from "ai"

import { chatModel } from "./model"
import { z } from "zod"

import {
  MAX_SEQUENCE_STEPS,
  type CompiledSequence,
  type SequenceSource,
  type SequenceStep,
} from "@workspace/api/schema"

/*
 * Compiling a sequence from prose.
 *
 * The author writes the flow the way they would explain it to a colleague —
 * "when someone asks about a refund, get their order number, then
 * @lookupOrder, then @startRefund" — and gets back ordered, typed steps.
 *
 * `generateObject` for the same reason `draft.ts` uses it: a sequence that
 * does not parse is worse than none, because it fails at conversation time
 * rather than authoring time.
 *
 * The compiler's real job is not the happy path — splitting prose on "then"
 * is easy. It is noticing what the prose left out. Which captured field feeds
 * which argument, and whether a mentioned tool exists at all, are questions
 * the sentence rarely answers, and a compiler that guesses at them silently
 * produces a flow that runs wrong without ever looking wrong.
 */

const StepSchema = z.object({
  kind: z
    .enum(["ask", "tool"])
    .describe(
      "'tool' when the step calls one of the available tools — these are the " +
        "@mentions in the source. 'ask' when the step gathers something from " +
        "the visitor before the flow can go on."
    ),
  field: z
    .string()
    .describe(
      "For 'ask' only: camelCase name the answer is stored under, e.g. " +
        "orderNumber. Later steps refer to it as $orderNumber. Empty for 'tool'."
    ),
  prompt: z
    .string()
    .describe(
      "For 'ask' only: what the model should find out, phrased as an " +
        "instruction to the model rather than a script to read out. Empty for " +
        "'tool'."
    ),
  tool: z
    .string()
    .describe(
      "For 'tool' only: the exact tool name, without the @. Must be one of " +
        "the available tools. Empty for 'ask'."
    ),
  inputFrom: z
    .string()
    .describe(
      'For \'tool\' only: a JSON object as a string, mapping the tool\'s ' +
        'arguments to fields captured earlier, e.g. {"city":"$location"}. Use ' +
        '"{}" when the source does not say which captured field feeds an ' +
        "argument — do not invent a mapping, an unmapped argument is filled " +
        "from the conversation, which is the safer default."
    ),
})

const CompileSchema = z.object({
  id: z
    .string()
    .describe(
      "camelCase identifier for the whole flow, e.g. refundRequest. A noun " +
        "phrase naming the flow, not a verb."
    ),
  label: z
    .string()
    .describe("Two or three words naming the flow, for a developer's list."),
  trigger: z
    .string()
    .describe(
      "When to start this flow, written around what a visitor would say, " +
        "naming the intents that should start it. This is the only thing the " +
        "model reads when deciding to begin, so it decides whether the " +
        "sequence ever fires."
    ),
  steps: z.array(StepSchema).describe("The steps, in the order given."),
  warnings: z
    .array(z.string())
    .describe(
      "Anything the source left genuinely ambiguous, one short line each, " +
        "addressed to the author: an argument you could not map to a captured " +
        "field, a step whose order was unclear, a tool that seemed wrong for " +
        "what was asked. Empty when the flow was unambiguous — do not pad it."
    ),
})

const SYSTEM = `You compile a described conversational flow into ordered steps.

The author writes how a support conversation should go, and references tools
by @name. You return the steps in order.

Two kinds of step, and telling them apart is most of the job:

- A 'tool' step calls a function. These are the @mentions.
- An 'ask' step gathers something from the visitor. "Get their email", "find
  out which model they have" — no function runs, but the flow does not move on
  until the answer is in hand.

Not every clause is a step. "Be friendly about it" is a manner, not a step.
Prose like "and then let them know" after a tool that already shows a card is
usually the model's ordinary reply, not a step of its own.

Order is the point. The author is describing this as a sequence precisely
because the order matters, so preserve it exactly as written, including when
an 'ask' has to come before the tool that consumes it.

On arguments: map a tool's argument to an earlier captured field only when the
source actually says so, or when one captured field is the obvious and only
candidate. Otherwise leave it unmapped and say so in a warning. An unmapped
argument gets filled from the conversation, which is recoverable; a wrongly
mapped one sends the wrong value and looks like it worked.

Only use tools from the available list. If the source mentions one that is not
there, leave that step out and warn about it — never substitute a similar name.`

/**
 * A description the author has to change before it can compile.
 *
 * A distinct type rather than a message prefix: the caller has to tell "this
 * text will never compile" from "the model had a bad minute", and matching on
 * wording makes that classification break the moment someone rewords an
 * error. It also silently mislabels everything it does not recognise — a
 * schema failure inside `generateObject` looked retryable and was not.
 */
export class SequenceAuthorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SequenceAuthorError"
  }
}

/** `refundFlow` → `refundFlow2`, skipping anything already taken. */
function uniqueId(base: string, taken: string[]): string {
  let n = 2
  while (taken.includes(`${base}${n}`)) n += 1
  return `${base}${n}`
}

/** Parses a JSON string the model produced, or throws with a usable message. */
function parseMapping(text: string): Record<string, string> | undefined {
  const trimmed = text?.trim()
  if (!trimmed || trimmed === "{}") return undefined

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    // Not fatal: an unmapped argument is filled from the conversation, which
    // is exactly the fallback the prompt asks for when the source is unclear.
    return undefined
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * Compiles a described flow into ordered, typed steps.
 *
 * Throws when nothing usable survives — a sequence with no steps would
 * register fine and then never do anything, which is harder to diagnose than
 * a failed compile.
 */
export async function compileSequence(
  model: string,
  { source, availableTools = [], existingIds = [] }: SequenceSource
): Promise<CompiledSequence> {
  const context = [
    `Flow as described:\n${source}`,
    availableTools.length
      ? `\n\nAvailable tools — @mentions must resolve to one of these: ` +
        availableTools.join(", ")
      : `\n\nNo tools are available. Every step must be an 'ask'; warn about ` +
        `any @mention in the source.`,
    existingIds.length
      ? `\n\nSequence ids already taken, pick a different one: ` +
        existingIds.join(", ")
      : "",
  ].join("")

  /*
   * Mentions are checked before the model sees them.
   *
   * The prompt forbids substituting a similar name, and the model does it
   * anyway — asked for `@curency` with only `getRate` available, it emitted a
   * step calling `getRate` and mentioned the swap in a warning. A warning is
   * the wrong place for that: the step reads as correct in the preview, and
   * the flow calls a tool the author never asked for.
   *
   * A misspelled mention is a typo, and the only safe thing to do with a typo
   * is refuse it while the author is still looking at the text.
   */
  const mentioned = [...source.matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(
    (match) => match[1]
  )
  const unknown = [...new Set(mentioned)].filter(
    (name) => !availableTools.includes(name as string)
  )
  if (unknown.length > 0) {
    throw new SequenceAuthorError(
      `no tool named ${unknown.map((n) => `@${n}`).join(", ")} — check the ` +
        `spelling, or pick it from the tool list`
    )
  }

  const { object } = await generateObject({
    model: chatModel(model),
    instructions: SYSTEM,
    prompt: context,
    schema: CompileSchema,
  })

  const warnings = [...object.warnings]
  const known = new Set(availableTools)

  /*
   * Checked here rather than trusted from the model.
   *
   * The prompt tells it to use only known tools, but a compile that quietly
   * emits a step calling a tool that does not exist produces a sequence that
   * stalls mid-conversation — the step can never complete, and the visitor is
   * stuck at it. Dropping the step and saying so is the recoverable failure.
   */
  const steps = object.steps.flatMap<SequenceStep>((step) => {
    if (step.kind === "tool") {
      const tool = step.tool?.trim().replace(/^@/, "")
      if (!tool) return []
      if (!known.has(tool)) {
        warnings.push(
          `Dropped a step calling "${tool}" — no tool by that name is ` +
            `registered. Re-pick it from the tool list.`
        )
        return []
      }
      return [{ kind: "tool" as const, tool, inputFrom: parseMapping(step.inputFrom) }]
    }

    const field = step.field?.trim()
    const prompt = step.prompt?.trim()
    if (!field || !prompt) {
      warnings.push(
        `Dropped a step that asks the visitor for something but did not say ` +
          `what — describe it more explicitly.`
      )
      return []
    }
    return [{ kind: "ask" as const, field, prompt }]
  })

  if (steps.length === 0) {
    throw new SequenceAuthorError(
      "nothing in that description compiled to a step — name the tools with " +
        "@ and say what to gather from the visitor"
    )
  }

  /*
   * A field read before it is written is the one error worth blocking on.
   * It is invisible in prose, and at conversation time it silently sends
   * undefined to a tool that will do something plausible with it.
   */
  const captured = new Set<string>()
  for (const step of steps) {
    if (step.kind === "ask") {
      captured.add(step.field)
      continue
    }
    for (const [argument, reference] of Object.entries(step.inputFrom ?? {})) {
      const field = reference.replace(/^\$/, "")
      if (!captured.has(field)) {
        warnings.push(
          `"${step.tool}" takes ${argument} from $${field}, which nothing ` +
            `earlier in the flow captures — it will be filled from the ` +
            `conversation instead.`
        )
      }
    }
  }

  /*
   * Truncation is reported, not silent.
   *
   * Every other drop in this function warns, for the reason the comments
   * above give: a compiler that discards silently produces a flow that runs
   * wrong without ever looking wrong. A fifteen-step description cut to
   * twelve previews as complete and then stops three steps early in a real
   * conversation, which is the same failure wearing a different hat.
   */
  if (steps.length > MAX_SEQUENCE_STEPS) {
    warnings.push(
      `Kept the first ${MAX_SEQUENCE_STEPS} steps and dropped ` +
        `${steps.length - MAX_SEQUENCE_STEPS} — that is the most a single ` +
        `flow can run. Split it into two.`
    )
  }

  /*
   * The id is checked rather than trusted, exactly as the @mentions are.
   *
   * `existingIds` reaches the model as a prompt hint, and the mention check
   * above exists because the model ignores that class of hint — it
   * substituted a similar tool name and merely warned about it. A colliding
   * id is worse than a wrong step: `registerSequence` keys by id, so
   * registering the new flow silently replaces a working one.
   */
  const id = existingIds.includes(object.id)
    ? uniqueId(object.id, existingIds)
    : object.id
  if (id !== object.id) {
    warnings.push(
      `Renamed this flow to "${id}" — "${object.id}" is already taken, and ` +
        `registering it would have replaced the existing one.`
    )
  }

  return {
    sequence: {
      id,
      label: object.label,
      trigger: object.trigger,
      steps: steps.slice(0, MAX_SEQUENCE_STEPS),
    },
    warnings: warnings.slice(0, 16),
  }
}
