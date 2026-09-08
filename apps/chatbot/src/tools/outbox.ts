import type { SequenceEvent } from "./sequences"

/*
 * Durable delivery for flow outcomes.
 *
 * `onSequence` is a runtime callback: it fires once, in the tab that produced
 * it, and if that listener is mid-`fetch` when the visitor closes the tab, the
 * lead is gone. For a console log that is fine. For "post the completed flow
 * to a CRM" it is not — the whole point of a lead-capture flow is that the
 * lead arrives.
 *
 * So an outcome is *written down first* and delivered second. The queue lives
 * in the visitor's browser alongside the transcript, for the same reason: the
 * server is stateless and has no auth, so there is nowhere else to put it that
 * is not worse. On the next page load anything undelivered is retried.
 *
 * What this buys, honestly:
 *
 *   - A failed or interrupted POST is retried, on this device, next visit.
 *   - A tab closed mid-send does not lose the outcome.
 *
 * What it does not:
 *
 *   - A visitor who never returns, or who clears site data, is unrecoverable.
 *     Nothing client-side can fix that — the durable copy has to be made by a
 *     server that already received it.
 *   - Delivery is at-least-once, not exactly-once. A response that never
 *     arrives is retried, so the endpoint must be idempotent; every entry
 *     carries an `id` for exactly that.
 *
 * The honest summary: this closes the common gaps (network blip, tab closed,
 * server briefly down) and cannot close the uncommon one. A backend that owns
 * retries is still the right answer for anything critical — this makes the
 * hand-off to it reliable enough to be worth having.
 */

const KEY = "freddy-chat-outbox"

/** Attempts before an entry is dropped rather than retried forever. */
export const MAX_ATTEMPTS = 5

/**
 * Entries kept.
 *
 * A cap for the same reason the transcript has one: this shares an origin
 * with whatever the host page stores. Oldest first — a queue is drained from
 * the front, so the front is what still matters.
 */
export const MAX_ENTRIES = 50

export type OutboxEntry = {
  /** Stable across retries, so a receiver can discard a duplicate. */
  id: string
  event: SequenceEvent
  /** When it was queued, so a receiver can tell a retry from a fresh event. */
  queuedAt: string
  attempts: number
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadOutbox(): OutboxEntry[] {
  const store = storage()
  if (!store) return []

  try {
    const raw = store.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    /*
     * Shape-checked rather than trusted. Stored data outlives the code that
     * wrote it, and one bad entry should cost that entry rather than block a
     * queue that may hold good ones behind it.
     */
    return parsed.filter(
      (entry): entry is OutboxEntry =>
        Boolean(entry) &&
        typeof (entry as OutboxEntry).id === "string" &&
        typeof (entry as OutboxEntry).attempts === "number" &&
        Boolean((entry as OutboxEntry).event)
    )
  } catch {
    return []
  }
}

function write(entries: OutboxEntry[]): void {
  const store = storage()
  if (!store) return

  const trimmed =
    entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries

  try {
    store.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    /*
     * Full, or blocked. Dropping the oldest half is better than losing the
     * queue: the newest outcome is the one most likely to still matter, and
     * an outbox that cannot be written at all silently stops retrying.
     */
    try {
      store.setItem(
        KEY,
        JSON.stringify(trimmed.slice(-Math.ceil(trimmed.length / 2)))
      )
    } catch {
      // In-memory delivery still happens; only the retry is lost.
    }
  }
}

/** Queues an outcome. Returns the entry, so a caller can deliver it at once. */
export function enqueue(event: SequenceEvent): OutboxEntry {
  const entry: OutboxEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    event,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  }
  write([...loadOutbox(), entry])
  return entry
}

/** Removes a delivered entry. */
export function settle(id: string): void {
  write(loadOutbox().filter((entry) => entry.id !== id))
}

/**
 * Records a failed attempt, dropping the entry once it has had enough.
 *
 * A bounded retry rather than an endless one: an endpoint that has rejected
 * the same payload five times is not going to accept it on the sixth, and a
 * queue that never drains is one that eventually fills.
 */
export function recordFailure(id: string): void {
  const next: OutboxEntry[] = []
  for (const entry of loadOutbox()) {
    if (entry.id !== id) {
      next.push(entry)
      continue
    }
    const attempts = entry.attempts + 1
    if (attempts < MAX_ATTEMPTS) next.push({ ...entry, attempts })
    else {
      console.warn(
        `[outbox] giving up on ${entry.event.kind} after ${attempts} ` +
          `attempts — the endpoint rejected it every time`
      )
    }
  }
  write(next)
}
