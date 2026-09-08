import type { ClientTool, Sequence, SequenceStep } from "@workspace/api"

/*
 * Sequences: pinning the order of a flow.
 *
 * The ordinary tool loop already lets the model chain calls — it sees each
 * result before choosing what to do next, and usually chooses well. A
 * sequence is for when "usually" is not good enough: a flow with real side
 * effects wants an order that holds on the turn where the model would
 * otherwise have skipped a step.
 *
 * The order is enforced by *withholding tools*, not by prompting. While a
 * sequence is running, `toolDefinitions()` returns only the step it is on,
 * so the request going upstream does not contain a later step at all. A tool
 * that is not in the model's context cannot be called however the visitor
 * phrases things, and that is a different guarantee from a well-written
 * instruction.
 *
 * Module-level, like the tool registry next door, and for the same reason: a
 * flow half-finished must not be lost when the panel unmounts.
 *
 * An `ask` step is served by two tools, not one, and the split is the
 * non-obvious part of this file. `toolChoice: "required"` means the model
 * cannot reply with a question and wait — it has to call something. Given
 * only a way to record an answer it called that with its own question as the
 * value, advanced, and looked up the weather for "Which city are you
 * travelling to?". So asking is a tool too: `__askVisitor` does nothing but
 * end the round, leaving the step uncaptured and the keyboard with the
 * visitor.
 */

const sequences = new Map<string, Sequence>()

/*
 * Where the active flow has got to.
 *
 * One at a time. Nesting sequences would mean deciding which one owns the
 * next visitor message, and there is no good answer — starting a second
 * abandons the first, which is at least legible.
 */
type ActiveSequence = {
  sequence: Sequence
  /** Index into `sequence.steps`. Equal to the length once finished. */
  index: number
  /** Answers captured by `ask` steps, keyed by field name. */
  captured: Record<string, unknown>
}

let active: ActiveSequence | null = null

/*
 * Flows that have already run to completion, this conversation.
 *
 * Clearing `active` was not enough on its own. The moment a flow ended, its
 * entry point went back on the wire — and the model, looking at a transcript
 * full of travel talk, started it again and re-ran the whole thing. From the
 * visitor's side the briefing simply repeated: the same weather card, then
 * "which city are you travelling to?".
 *
 * The model has no memory of "that flow just finished"; the transcript only
 * shows tools being called. So completion is remembered here instead, and a
 * finished flow's entry point is withheld for the rest of the conversation.
 *
 * Conversation-scoped, like the flow itself — `reset()` clears both, so a new
 * chat can run the same flow again.
 */
const completed = new Set<string>()

/*
 * Lifecycle events.
 *
 * A flow starting, each step landing, and the flow ending are the moments a
 * host page actually wants: a lead is not captured when the form renders, it
 * is captured when the flow that gathered it finishes, and "the visitor
 * abandoned halfway" is a different fact from "the visitor never started".
 * None of that is derivable from tool calls alone — a handler sees its own
 * arguments and nothing about the flow around it.
 *
 * Modelled on `onWidgetAction` next door, and deliberately fire-and-forget:
 * a listener that throws must not take the conversation down with it, and
 * nothing here waits on a promise. This reports what happened; it does not
 * decide what happens.
 */

export type SequenceEvent =
  | { kind: "start"; sequence: string; label: string; steps: number }
  | {
      kind: "step"
      sequence: string
      label: string
      /** 1-based, so it reads the way the playground numbers them. */
      step: number
      steps: number
      /** Set when the step captured an answer. */
      field?: string
      value?: unknown
      /** Set when the step ran a tool. */
      tool?: string
    }
  | {
      kind: "end"
      sequence: string
      label: string
      /**
       * `completed` ran every step; `cancelled` was abandoned partway.
       * Different facts: one is a lead, the other is a drop-off.
       */
      reason: "completed" | "cancelled"
      /** Everything the flow gathered, keyed by field. */
      captured: Record<string, unknown>
      /** How far it got, for a cancellation. */
      reached: number
      steps: number
    }

type SequenceSubscriber = (event: SequenceEvent) => void

const listeners = new Set<SequenceSubscriber>()

/**
 * Subscribes to flow lifecycle events. Returns an unsubscribe function.
 *
 * ```ts
 * FreddyChat.onSequence((event) => {
 *   if (event.kind === "end" && event.reason === "completed") {
 *     crm.createLead(event.captured)
 *   }
 * })
 * ```
 */
export function onSequence(callback: SequenceSubscriber): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function emit(event: SequenceEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (cause) {
      // A host bug is not the conversation's problem: the flow carries on.
      console.warn("[sequences] listener failed:", cause)
    }
  }
}

/*
 * Tools the sequence machinery itself exposes.
 *
 * Named with a prefix a page-defined tool cannot collide with — the registry
 * rejects names that are not alphanumeric-with-underscores, so a leading
 * double underscore is ours by construction.
 */
const CAPTURE_TOOL = "__captureField"
const CANCEL_TOOL = "__cancelSequence"
/*
 * Asking, as a callable action.
 *
 * Needed because `toolChoice: "required"` forces a tool call every turn: the
 * model physically cannot reply with a question and wait for an answer. Given
 * only a capture tool it does the one thing that satisfies the constraint —
 * calls capture with its own question as the value, and the flow advances
 * holding "Which city are you travelling to?" as the destination.
 *
 * So waiting has to be something it can *call*. This tool does nothing but
 * return, which ends the round with the question already streamed as prose;
 * the sequence stays on the same step, and the visitor's reply arrives on the
 * next turn with the field still uncaptured.
 */
const ASK_TOOL = "__askVisitor"

/** Reserved names, so a page-defined tool cannot shadow the machinery. */
export function isReservedToolName(name: string): boolean {
  return name === CAPTURE_TOOL || name === CANCEL_TOOL || name === ASK_TOOL
}

export function isAskTool(name: string): boolean {
  return name === ASK_TOOL
}

export function registerSequence(sequence: Sequence): boolean {
  if (!sequence?.id || !sequence.steps?.length) {
    console.warn(`[sequences] invalid sequence ${JSON.stringify(sequence?.id)}`)
    return false
  }
  sequences.set(sequence.id, sequence)
  return true
}

export function unregisterSequence(id: string): boolean {
  // Cancel first: leaving a flow pointing at a definition that is gone would
  // strand the conversation on a step that can never complete.
  if (active?.sequence.id === id) cancelSequence()
  return sequences.delete(id)
}

export function listSequences(): Sequence[] {
  return [...sequences.values()]
}

export function activeSequence(): ActiveSequence | null {
  return active
}

/**
 * Which steps of a sequence cannot run against the current tool registry.
 *
 * A sequence is authored once and used for months, while the page's tools
 * come and go — so a flow can reference a tool that no longer exists, and the
 * failure would otherwise be a conversation stuck on a step forever. Mirrors
 * the drift checking the tool registry does for transcripts.
 */
export function brokenSteps(
  sequence: Sequence,
  hasTool: (name: string) => boolean
): string[] {
  return sequence.steps
    .filter((step) => step.kind === "tool" && !hasTool(step.tool))
    .map((step) => (step as Extract<SequenceStep, { kind: "tool" }>).tool)
}

/**
 * Starts a flow, if every tool it needs is still registered.
 *
 * Refuses rather than starting a flow that cannot finish: a sequence that
 * stalls halfway leaves the visitor mid-conversation with no way forward,
 * which is worse than never having narrowed the tools at all.
 */
export function startSequence(
  id: string,
  hasTool: (name: string) => boolean
): { started: boolean; reason?: string } {
  const sequence = sequences.get(id)
  if (!sequence) return { started: false, reason: `no sequence "${id}"` }

  /*
   * Checked here as well as by withholding the entry point.
   *
   * The tool is off the wire once a flow completes, but a call can still
   * arrive — replayed from history, or emitted before the definitions caught
   * up — and restarting silently is exactly the failure this guards: the
   * visitor watches the whole flow run a second time.
   */
  if (completed.has(id)) {
    return {
      started: false,
      reason: `it has already run in this conversation`,
    }
  }

  const broken = brokenSteps(sequence, hasTool)
  if (broken.length > 0) {
    return {
      started: false,
      reason:
        `it needs ${broken.map((t) => `"${t}"`).join(", ")}, which ` +
        `${broken.length === 1 ? "is" : "are"} not registered on this page`,
    }
  }

  active = { sequence, index: 0, captured: {} }
  emit({
    kind: "start",
    sequence: sequence.id,
    label: sequence.label,
    steps: sequence.steps.length,
  })
  return { started: true }
}

/**
 * Abandons a running flow if it can no longer finish without `name`.
 *
 * Called when a tool is unregistered. `startSequence` checks up front, but a
 * page can unregister at any moment — and a flow left running past that point
 * is the worst state available: `sequenceTools` returns cancel alone, while
 * `toolChoice` still forces a call and the instruction still says to run a
 * step whose tool is gone. The model is told to do something impossible and
 * given one way out, which it takes; cancelling here does that deliberately
 * instead, and one turn earlier.
 */
export function cancelIfDependsOn(name: string): void {
  if (!active) return
  const needed = active.sequence.steps.some(
    (step) => step.kind === "tool" && step.tool === name
  )
  if (needed) cancelSequence()
}

export function cancelSequence(): void {
  /*
   * Not marked completed: abandoning is not finishing. A visitor who bailed
   * to ask something else may well want the flow afterwards, and refusing to
   * offer it again would punish them for the detour.
   */
  if (!active) return

  const { sequence, index, captured } = active
  active = null
  /*
   * Emitted after clearing, so a listener that starts another flow — a
   * perfectly reasonable thing to do on an abandonment — is not fighting a
   * pointer that still says this one is running.
   */
  emit({
    kind: "end",
    sequence: sequence.id,
    label: sequence.label,
    reason: "cancelled",
    captured,
    reached: index,
    steps: sequence.steps.length,
  })
}

/** The step the flow is waiting on, or null when nothing is running. */
export function currentStep(): SequenceStep | null {
  if (!active) return null
  return active.sequence.steps[active.index] ?? null
}

/**
 * Arguments a tool step pins from earlier answers.
 *
 * Merged *over* what the model supplied, not under it: the point of pinning
 * an argument is that the captured value wins. Anything the flow does not pin
 * is left exactly as the model filled it.
 */
export function pinnedInput(input: unknown): Record<string, unknown> {
  const supplied = (input ?? {}) as Record<string, unknown>
  const step = currentStep()
  if (!active || step?.kind !== "tool" || !step.inputFrom) return supplied

  const pinned: Record<string, unknown> = {}
  for (const [argument, reference] of Object.entries(step.inputFrom)) {
    const field = reference.replace(/^\$/, "")
    /*
     * Compared against undefined rather than tested with `in`.
     *
     * A key set to `undefined` satisfies `in`, so a field that had been
     * "captured" as nothing still merged over the model's own argument —
     * turning a usable value into a missing one. A field with no usable value
     * is left to whatever the model supplied; the compiler warns about the
     * genuinely-unmapped case at authoring time.
     */
    if (active.captured[field] !== undefined) {
      pinned[argument] = active.captured[field]
    }
  }
  return { ...supplied, ...pinned }
}

/**
 * Advances past the step a tool call just satisfied.
 *
 * Called after the handler resolves, from the chat loop's drain. Only the
 * *current* step advances the flow: a model that somehow answers a later step
 * has not completed this one, and letting it skip ahead would undo the
 * ordering this whole module exists to provide.
 */
export function advance(
  toolName: string,
  input: Record<string, unknown>
): void {
  const step = currentStep()
  if (!active || !step) return

  const at = active.index

  if (step.kind === "ask") {
    // Asking is not answering: `__askVisitor` ends the round with the field
    // still uncaptured, so the flow waits on the same step.
    if (toolName !== CAPTURE_TOOL) return

    /*
     * An empty capture is not a capture.
     *
     * `runTool` answers the reserved tools before its required-argument check
     * runs, so the schema's `required: ["value"]` never gates this one — a
     * model calling it with `{}` used to advance the flow having recorded
     * nothing, and the pinned `undefined` then overwrote a perfectly good
     * argument on the *next* step. The visitor watched the flow fail on a
     * step it had already passed.
     */
    const value = typeof input.value === "string" ? input.value.trim() : input.value
    if (value === undefined || value === null || value === "") return

    // The model reports what it gathered; the field name comes from the step,
    // not from the model, so it cannot write somewhere the flow does not read.
    active.captured[step.field] = value
    active.index += 1
    emit({
      kind: "step",
      sequence: active.sequence.id,
      label: active.sequence.label,
      step: at + 1,
      steps: active.sequence.steps.length,
      field: step.field,
      value: input.value,
    })
  } else if (toolName === step.tool) {
    active.index += 1
    emit({
      kind: "step",
      sequence: active.sequence.id,
      label: active.sequence.label,
      step: at + 1,
      steps: active.sequence.steps.length,
      tool: step.tool,
    })
  }

  /*
   * Finished flows release their hold on the tool set immediately, so the
   * model's closing sentence is composed with everything back in context —
   * but they are remembered, so the entry point is not offered again and the
   * model cannot restart what it just finished.
   */
  if (active.index >= active.sequence.steps.length) {
    const { sequence, captured } = active
    completed.add(sequence.id)
    active = null
    /*
     * The event a host actually integrates against. A lead is not captured
     * when the form renders — it is captured when the flow that gathered it
     * finishes, with everything it collected in one place.
     */
    emit({
      kind: "end",
      sequence: sequence.id,
      label: sequence.label,
      reason: "completed",
      captured,
      reached: sequence.steps.length,
      steps: sequence.steps.length,
    })
  }
}

/**
 * The tools to send upstream, given everything the page has registered.
 *
 * With no sequence running this is the page's own tools plus an entry point
 * per sequence — the model starts a flow the same way it calls anything else,
 * by reading a description and deciding it matches, which is what keeps this
 * working across languages and phrasings that a keyword match would miss.
 *
 * With a sequence running it is exactly one step's tool, plus cancel. That
 * narrowing is the enforcement.
 */
export function sequenceTools(pageTools: ClientTool[]): ClientTool[] {
  const step = currentStep()

  if (!active || !step) {
    if (sequences.size === 0) return pageTools
    return [...pageTools, ...entryTools()]
  }

  /*
   * Cancel is always offered, and is not optional politeness. A visitor who
   * changes their mind mid-flow — asks about opening hours, says never mind —
   * would otherwise be held in a flow whose only exit is a tool call they do
   * not want to make.
   */
  const escape: ClientTool = {
    name: CANCEL_TOOL,
    description:
      `Abandon the "${active.sequence.label}" flow currently in progress. ` +
      `Call this as soon as the visitor changes the subject, asks for ` +
      `something unrelated, or says they no longer want to continue. Do not ` +
      `keep them in a flow they have moved on from.`,
    inputSchema: { type: "object", properties: {} },
  }

  if (step.kind === "ask") {
    return [
      {
        /*
         * Listed first, and described as the default. The two tools are
         * easily confused — both are "about" the same question — so the
         * distinction is stated in terms of what has already happened rather
         * than what the model intends.
         */
        name: ASK_TOOL,
        description:
          `Ask the visitor for this and wait for their reply: ${step.prompt}. ` +
          `Use this whenever they have NOT yet given you the answer — ` +
          `including the first time you ask. Their reply arrives as their ` +
          `next message.`,
        inputSchema: {
          type: "object",
          properties: {
            /*
             * The question is an argument rather than an instruction to write
             * prose alongside the call.
             *
             * Told to "put the question in your reply", the model frequently
             * called this with no text at all — the visitor got a silent turn
             * with nothing to answer. An argument is not optional in the same
             * way: the schema requires it, and whatever arrives can be shown
             * whether or not the model also narrated.
             */
            question: {
              type: "string",
              description:
                `The question to show the visitor, in your own words. Ask ` +
                `only for this one thing, conversationally, without ` +
                `restating the whole flow.`,
            },
          },
          required: ["question"],
        },
      },
      {
        name: CAPTURE_TOOL,
        description:
          `Record the answer the visitor has ALREADY given for this: ` +
          `${step.prompt}. Only call this when their answer is in the ` +
          `conversation above — never with a question, a placeholder, or a ` +
          `value you inferred. If they have not answered yet, use ` +
          `${ASK_TOOL} instead.`,
        inputSchema: {
          type: "object",
          properties: {
            value: {
              type: "string",
              description:
                `The visitor's own answer, quoted from what they said. Not ` +
                `your question, and not a summary of the request.`,
            },
          },
          required: ["value"],
        },
      },
      escape,
    ]
  }

  /*
   * The step's own tool, with its page-authored definition intact — the
   * description is what makes the model call it correctly, so it is narrowed
   * away from, never rewritten.
   */
  const definition = pageTools.find((tool) => tool.name === step.tool)
  return definition ? [definition, escape] : [escape]
}

/** Entry points, one per registered sequence. */
function entryTools(): ClientTool[] {
  return [...sequences.values()]
    .filter((sequence) => !completed.has(sequence.id))
    .map((sequence) => ({
      name: startToolName(sequence.id),
      description:
        `${sequence.trigger}\n\nCalling this begins a fixed ${sequence.steps.length}-step ` +
        `process, and the steps after it are handled for you — do not try to ` +
        `carry out the whole flow yourself.`,
      inputSchema: { type: "object", properties: {} },
    }))
}

const START_PREFIX = "__start_"

export function startToolName(id: string): string {
  return `${START_PREFIX}${id}`
}

/** The sequence id behind an entry-point call, if that is what this is. */
export function sequenceIdForStartTool(name: string): string | null {
  return name.startsWith(START_PREFIX) ? name.slice(START_PREFIX.length) : null
}

export function isCancelTool(name: string): boolean {
  return name === CANCEL_TOOL
}

/**
 * Rounds a turn may need, given what is running.
 *
 * A flow needs at least a round per remaining step, plus room for the closing
 * reply — the default cap was chosen for ad-hoc tool use and would cut a long
 * flow off partway through, which looks exactly like the model giving up.
 */
export function roundsNeeded(fallback: number): number {
  if (!active) return fallback
  /*
   * Counted from the whole flow, not from what is left.
   *
   * The caller re-reads this every round while its own counter climbs, so a
   * bound derived from *remaining* steps falls as the flow advances and the
   * two eventually cross: a six-step flow abandoned itself at round six, one
   * step from the end, which is precisely the "model gave up" failure this
   * exists to prevent.
   *
   * Two rounds per step, because an `ask` legitimately takes one round to ask
   * and another to record the reply, plus room for the closing sentence.
   */
  const total = active.sequence.steps.length
  return Math.max(fallback, total * 2 + 2)
}

/*
 * Keeping the model on the step.
 *
 * Narrowing the tool set is the hard constraint — a step's tool is the only
 * one on the wire, so a later one cannot be called however the conversation
 * goes. But that is only half of it, and the half that fails quietly: nothing
 * in a narrowed tool set stops the model answering an unrelated question in
 * prose and leaving the step unstarted. The flow then looks alive and is not.
 *
 * The AI SDK has no guardrails API for this — per-step instructions and
 * `toolChoice` are what it documents, so both are asked for here and applied
 * server-side.
 */

/**
 * Whether the model must call a tool this turn.
 *
 * `required` only while a flow is running. Forcing a tool call on an ordinary
 * turn would be worse than useless: the model would have to call something to
 * answer "thanks, that's all", and the nearest tool would win.
 */
export function turnToolChoice(): "required" | undefined {
  return active ? "required" : undefined
}

/**
 * The extra system-prompt line for this turn, when a flow is running.
 *
 * Says three things, in the order they go wrong: what the flow is doing, that
 * an off-topic question must not derail it, and that abandoning is a real
 * option rather than something to resist. The last one matters — a model told
 * only to stay on task will fight a visitor who has genuinely moved on.
 */
export function turnInstruction(): string | undefined {
  const step = currentStep()
  if (!active || !step) return undefined

  const position = `step ${active.index + 1} of ${active.sequence.steps.length}`
  const task =
    step.kind === "ask"
      ? `You are finding out: ${step.prompt}. Ask for it in your own words, ` +
        `then record it with the tool provided.`
      : `You are running the "${step.tool}" step. Call it now.`

  return [
    `You are part-way through the "${active.sequence.label}" flow — ${position}.`,
    task,
    `Only the tool for this step is available to you. Do not answer unrelated ` +
      `questions, start another topic, or skip ahead: acknowledge briefly and ` +
      `bring them back to what you asked.`,
    `The exception is a visitor who has genuinely moved on or asks to stop — ` +
      `abandon the flow with the cancel tool rather than holding them in it.`,
  ].join(" ")
}

/**
 * Forgets which flows have run, without unregistering them.
 *
 * Called when a conversation is reset: a new chat should be able to run a
 * flow the previous one finished.
 */
export function clearCompleted(): void {
  completed.clear()
}
