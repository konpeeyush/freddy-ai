import {
  enqueue,
  loadOutbox,
  recordFailure,
  settle,
  type OutboxEntry,
} from "./outbox"
import { onSequence, type SequenceEvent } from "./sequences"

/*
 * Delivering flow outcomes to the host's endpoint.
 *
 * Sits between `onSequence` and the network: every outcome is written to the
 * outbox first, then sent. A send that fails, or a tab that closes mid-flight,
 * leaves the entry queued and it is retried on the next page load.
 *
 * Deliberately separate from `onSequence` rather than replacing it. A host
 * that only wants to log, or to update its own UI, should not have to think
 * about queues — and a host that wants delivery should not have to write the
 * retry logic. Both exist; they answer different questions.
 */

export type DeliveryOptions = {
  /** Where to POST. Called with `{ id, event, queuedAt, attempts }`. */
  url: string
  /** Extra headers — an API key, a tenant id. */
  headers?: Record<string, string>
  /**
   * Which outcomes to send. Defaults to completed flows only, which is what
   * a CRM wants: an abandoned flow is a drop-off, not a lead, and sending
   * both without saying so would put half-filled records in someone's
   * pipeline.
   */
  filter?: (event: SequenceEvent) => boolean
}

let options: DeliveryOptions | null = null
let unsubscribe: (() => void) | null = null
/*
 * Tracked in module scope alongside the subscription, because both are
 * replaced when `deliverSequences` is called a second time — the docstring
 * invites exactly that ("calling again replaces the configuration"), and a
 * listener left attached would flush once per stale registration on every
 * page hide.
 */
let detachVisibility: (() => void) | null = null
/** Guards against two drains running at once and double-sending an entry. */
let draining = false

const completedFlowsOnly = (event: SequenceEvent) =>
  event.kind === "end" && event.reason === "completed"

/**
 * Sends one entry.
 *
 * `keepalive` is the reason this is a bare `fetch` rather than anything
 * fancier: it asks the browser to finish the request even if the page is
 * being torn down, which is exactly the case the outbox exists for. It is
 * capped at 64KB, which a flow outcome is comfortably under.
 */
async function send(
  entry: OutboxEntry,
  target: DeliveryOptions
): Promise<boolean> {
  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...target.headers },
      body: JSON.stringify(entry),
      keepalive: true,
    })

    /*
     * A 4xx other than 408/429 is the endpoint saying "not this payload" —
     * retrying is pointless and just burns the attempt budget on something
     * that will never succeed. Treated as delivered so it leaves the queue.
     */
    if (!response.ok) {
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      if (permanent) {
        console.warn(
          `[outbox] endpoint rejected ${entry.event.kind} with ` +
            `${response.status}; not retrying`
        )
        return true
      }
      return false
    }
    return true
  } catch {
    // Offline, DNS, CORS, or the tab went away mid-flight. Worth retrying.
    return false
  }
}

/**
 * Drains the queue, oldest first.
 *
 * Sequential rather than parallel: these are ordered outcomes from one
 * visitor, and a receiver reading them in order can reconstruct what
 * happened. Firing them all at once would also hammer an endpoint that is
 * already failing, which is the situation the queue implies.
 */
export async function flush(): Promise<void> {
  /*
   * Captured once, and passed down.
   *
   * `flush` awaits between entries, and the disposer sets `options` to null —
   * so a widget unmounted mid-drain used to null-deref inside `send`, get
   * swallowed by its own catch, and burn a retry attempt on every queued
   * entry for a reason that had nothing to do with the endpoint.
   */
  const target = options
  if (!target || draining) return
  draining = true

  try {
    for (const entry of loadOutbox()) {
      if (await send(entry, target)) settle(entry.id)
      else {
        recordFailure(entry.id)
        /*
         * Stop at the first failure. The usual cause is the network or the
         * endpoint being down, and the rest of the queue will fail the same
         * way — spending every entry's attempt budget on one outage is how a
         * queue empties itself without delivering anything.
         */
        break
      }
    }
  } finally {
    draining = false
  }
}

/**
 * Starts posting flow outcomes to an endpoint.
 *
 * ```ts
 * FreddyChat.deliverSequences({
 *   url: "https://example.com/api/leads",
 *   headers: { "x-api-key": "…" },
 * })
 * ```
 *
 * Queues anything undelivered and retries on the next load. Call once;
 * calling again replaces the configuration.
 */
export function deliverSequences(next: DeliveryOptions): () => void {
  unsubscribe?.()
  detachVisibility?.()
  options = next

  const wanted = next.filter ?? completedFlowsOnly

  unsubscribe = onSequence((event) => {
    if (!wanted(event)) return
    // Written down before anything is attempted: a send that never returns
    // must not be the only record that the flow finished.
    enqueue(event)
    void flush()
  })

  /*
   * Anything left from a previous visit goes now. This is the retry that
   * makes the queue worth keeping — a tab closed mid-send, or an endpoint
   * that was down an hour ago, resolves itself here.
   */
  void flush()

  /*
   * One more attempt as the page goes away. `visibilitychange` rather than
   * `unload`, which mobile Safari never fires; `hidden` is the last event a
   * backgrounded tab reliably gets.
   */
  const onHidden = () => {
    if (document.visibilityState === "hidden") void flush()
  }
  document.addEventListener("visibilitychange", onHidden)
  detachVisibility = () =>
    document.removeEventListener("visibilitychange", onHidden)

  return () => {
    unsubscribe?.()
    unsubscribe = null
    detachVisibility?.()
    detachVisibility = null
    options = null
  }
}
