import type { Sequence } from "@workspace/api"

/*
 * The authored form of a sequence.
 *
 * A flow is written as prose with tools referenced by `@name`, inserted from
 * a picker rather than typed. What gets *stored* is the prose plus the list
 * of tool ids the mentions resolved to — not the display text alone.
 *
 * That split is the point. A sequence is authored once and used for months,
 * while the page's tools come and go: `unregisterTool("getWeather")` would
 * otherwise silently break every flow mentioning it, with nothing to detect
 * it by until a visitor got stuck mid-conversation. Keeping the ids means a
 * flow can be checked against the live registry at any time — the same
 * problem `fingerprint`/`drift` solve for transcripts, one level up.
 */

export type SequenceDraft = {
  /** The prose as written, `@name` mentions and all. */
  source: string
  /** Tool names the mentions resolved to, in order of first appearance. */
  mentions: string[]
  /** The compiled result, once there is one. Editable before registering. */
  compiled?: Sequence
}

export const EMPTY_SEQUENCE: SequenceDraft = { source: "", mentions: [] }

/*
 * Mentions.
 *
 * Parsed rather than tracked as the author types: a textarea has no place to
 * hang a token on, and reconstructing the list from the text on demand is
 * both simpler and self-correcting when someone edits a name by hand.
 */
const MENTION = /@([a-zA-Z_][a-zA-Z0-9_]*)/g

/** Tool names mentioned in the prose, deduped, in order of first appearance. */
export function mentionsIn(source: string): string[] {
  return [...new Set([...source.matchAll(MENTION)].map((m) => m[1]))]
}

/**
 * Mentions that do not name a registered tool.
 *
 * The picker only inserts real names, but the text stays editable afterwards
 * — and `@curency` for `@currency` is exactly the typo it invites. Caught at
 * authoring time, where it is one keystroke to fix.
 */
export function unknownMentions(
  source: string,
  available: string[]
): string[] {
  const known = new Set(available)
  return mentionsIn(source).filter((name) => !known.has(name))
}

/**
 * Inserts a mention at the caret, replacing the `@fragment` being typed.
 *
 * Returns the new text and where the caret should land, since the caller has
 * to restore it — writing `value` moves the caret to the end otherwise, which
 * throws the author out of the sentence they were mid-way through.
 */
export function insertMention(
  source: string,
  caret: number,
  tool: string
): { source: string; caret: number } {
  const before = source.slice(0, caret)
  // Back to the `@` that opened the fragment, if the caret is still in one.
  const at = before.lastIndexOf("@")
  const fragment = at === -1 ? null : before.slice(at)

  const start =
    fragment !== null && /^@[a-zA-Z0-9_]*$/.test(fragment) ? at : caret

  // A trailing space, so the next word does not run into the mention.
  const inserted = `@${tool} `
  const next = source.slice(0, start) + inserted + source.slice(caret)
  return { source: next, caret: start + inserted.length }
}

/**
 * The `@fragment` the caret sits in, if any — what the picker filters on.
 *
 * Null when the caret is not in a mention, which is what closes the picker.
 */
export function activeFragment(
  source: string,
  caret: number
): string | null {
  const before = source.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at === -1) return null

  const fragment = before.slice(at + 1)
  // A space ends a mention: `@get weather` is a mention followed by a word,
  // not a two-word mention.
  return /^[a-zA-Z0-9_]*$/.test(fragment) ? fragment : null
}

/**
 * Steps of a compiled sequence whose tool is no longer registered.
 *
 * Shown against a saved flow, so a tool removed from the page surfaces as a
 * flow to fix rather than as a conversation that stalls on a step it can
 * never complete.
 */
export function brokenIn(sequence: Sequence, available: string[]): string[] {
  const known = new Set(available)
  return sequence.steps
    .filter((step) => step.kind === "tool" && !known.has(step.tool))
    .map((step) => (step as { tool: string }).tool)
}

const STORAGE_KEY = "freddy:dev:sequences"

export function loadSequences(): SequenceDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SequenceDraft[]) : []
  } catch {
    return []
  }
}

export function saveSequences(drafts: SequenceDraft[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Storage full or blocked. The flows are still live in memory for this
    // session, which beats failing the save the author just made.
  }
}
