import type { Sequence, SequenceStep } from "@workspace/api"

/*
 * Edited triggers for the shipped sequences.
 *
 * The trigger is to a sequence what the description is to a tool: the only
 * thing the model reads when deciding whether to begin, and the reason a flow
 * that looks right never fires. It is guesswork until tried against real
 * prompts, so it is editable here rather than only in the source file.
 *
 * The steps are editable too, but structurally rather than as text. Their
 * order is the whole content of a sequence, and the rules that keep one
 * runnable — a tool that exists, a field written before it is read — are the
 * compiler's. Re-parsing prose in the browser would mean owning those twice;
 * editing typed steps means `validateSteps` below can check the same rules
 * against the live registry, which text never could.
 *
 * Mirrors `./overrides` for tools, down to the revert behaviour: a sequence
 * with nothing stored registers exactly as authored.
 */

const STORAGE_KEY = "widget-playground-sequence-overrides"

/** The editable half of a sequence. */
export type SequenceOverride = {
  trigger: string
  /** Absent means the shipped steps, so a trigger-only edit stays minimal. */
  steps?: SequenceStep[]
}

/**
 * Why a set of edited steps cannot run.
 *
 * The same two rules the compiler enforces server-side, checked here against
 * the live tool registry — which the compiler cannot see. Returns an empty
 * array when the steps are sound.
 *
 * Both failures are invisible in the editor and expensive at conversation
 * time: a missing tool strands the flow on a step it can never complete, and
 * a field read before it is written sends undefined to a tool that will do
 * something plausible with it.
 */
export function validateSteps(
  steps: SequenceStep[],
  hasTool: (name: string) => boolean
): string[] {
  const problems: string[] = []
  if (steps.length === 0) return ["A flow needs at least one step."]

  const captured = new Set<string>()
  steps.forEach((step, index) => {
    const position = `Step ${index + 1}`

    if (step.kind === "ask") {
      if (!step.field.trim()) problems.push(`${position} has no field name.`)
      if (!step.prompt.trim()) problems.push(`${position} has nothing to ask for.`)
      captured.add(step.field)
      return
    }

    if (!hasTool(step.tool)) {
      problems.push(`${position} calls "${step.tool}", which is not registered.`)
    }
    for (const [argument, reference] of Object.entries(step.inputFrom ?? {})) {
      const field = reference.replace(/^\$/, "")
      if (!captured.has(field)) {
        problems.push(
          `${position} takes ${argument} from $${field}, which no earlier ` +
            `step captures.`
        )
      }
    }
  })

  return problems
}

export type SequenceOverrides = Record<string, SequenceOverride>

export function loadSequenceOverrides(): SequenceOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    const out: SequenceOverrides = {}
    for (const [id, value] of Object.entries(parsed as SequenceOverrides)) {
      // A stored override whose shape has drifted is dropped rather than
      // registered, which would leave a flow with no trigger at all.
      if (value && typeof value.trigger === "string" && value.trigger.trim()) {
        out[id] = {
          trigger: value.trigger,
          // Shape-checked at use, not here: a stored step referencing a tool
          // that has since gone is a real case, and `validateSteps` reports
          // it against the live registry rather than silently dropping it.
          steps: Array.isArray(value.steps) ? value.steps : undefined,
        }
      }
    }
    return out
  } catch {
    // Corrupt entry. The shipped triggers are a fine fallback.
    return {}
  }
}

export function saveSequenceOverrides(overrides: SequenceOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Private browsing. Edits still apply for this session.
  }
}

/**
 * Applies an override to a sequence, keeping its steps.
 *
 * Returns the sequence unchanged when nothing is stored for it, so the
 * shipped trigger is what registers by default.
 */
export function withSequenceOverride(
  sequence: Sequence,
  overrides: SequenceOverrides
): Sequence {
  const override = overrides[sequence.id]
  if (!override) return sequence
  return {
    ...sequence,
    trigger: override.trigger,
    steps: override.steps ?? sequence.steps,
  }
}

/** True when a sequence is running with something other than it ships with. */
export function isSequenceOverridden(
  id: string,
  overrides: SequenceOverrides
): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, id)
}
