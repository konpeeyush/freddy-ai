import {
  emitWidgetAction,
  getWidgetChatSender,
  hasWidgetActionListener,
  type WidgetActionEvent,
} from "./events"
import { isSafeUrl, type Action } from "./tree"

/*
 * Action dispatch.
 *
 * Two things a widget action can do: open a link, or emit an intent. No
 * stored code, ever — an action is data describing which registered function
 * to call, and the host decides what that means.
 */

/** A hung host handler must not spin forever. */
export const ACK_TIMEOUT_MS = 10_000

/**
 * A timeout is a failure, not a success. Without this distinction a hung
 * handler would flash the green tick and the visitor would believe the
 * booking went through.
 */
export class AckTimeoutError extends Error {
  constructor() {
    super(`widget action acknowledgment timed out after ${ACK_TIMEOUT_MS}ms`)
    this.name = "AckTimeoutError"
  }
}

export type DispatchResult = {
  /** True when at least one listener returned a promise — a real ack. */
  acked: boolean
  /**
   * Settles with the ack; resolves immediately when unacked.
   *
   * Resolves with replacement widget data when a listener returns some — that
   * is how a booking moves itself from one state to the next. `undefined`
   * means "acknowledged, nothing to change".
   */
  done: Promise<unknown>
}

/**
 * Visitor-safe message from a rejection. Shown verbatim ONLY when the host
 * signals it deliberately — by rejecting with a string, or with an Error
 * carrying a string `userMessage`:
 *
 *   throw "Only 2 spots left"                                     // shown
 *   throw Object.assign(new Error("SKU depleted"),
 *                       { userMessage: "Only 2 spots left" })     // shown
 *   throw new Error("Cannot read properties of undefined")        // NOT shown
 *
 * Everything else returns null and the caller renders its generic failure, so
 * a stack trace or a host bug never surfaces in the conversation.
 */
export function visitorMessageFromRejection(cause: unknown): string | null {
  if (typeof cause === "string" && cause.trim()) return cause.trim()
  if (cause instanceof Error) {
    const message = (cause as Error & { userMessage?: unknown }).userMessage
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return null
}

/**
 * What the click looks like when it lands in the conversation, on the
 * no-listener path. Reads as something a person would have typed.
 */
function formatActionMessage(event: WidgetActionEvent): string {
  const label = (event.label ?? event.functionName.replace(/[_-]+/g, " ")).trim()
  const payload = event.payload ?? {}

  // Prefer a human-readable subject over raw ids.
  const subject = ["name", "title", "label", "item_name"]
    .map((key) => payload[key])
    .find((value): value is string => typeof value === "string" && value !== "")

  const ids = ["id", "item_id", "product_id", "slot_id", "variant_id"]
    .filter(
      (key) => typeof payload[key] === "string" || typeof payload[key] === "number"
    )
    .map((key) => `${key}: ${payload[key]}`)

  let message = subject ? `${label}: ${subject}` : label
  if (ids.length > 0) message += ` (${ids.join(", ")})`
  return message
}

/**
 * Emits an intent.
 *
 * Three tiers, in order: an async host listener (real ack), a synchronous one
 * (no ack, brief flash), or none at all — in which case the click becomes a
 * visitor message and the AI drives the rest of the flow.
 */
export function dispatchWidgetAction(
  event: WidgetActionEvent
): DispatchResult {
  const { promises } = emitWidgetAction(event)

  if (promises.length === 0) {
    // A registered listener — even a synchronous one — suppresses the chat
    // fallback: the host has said it is handling this.
    if (!hasWidgetActionListener()) {
      const send = getWidgetChatSender()
      if (send) {
        try {
          send(formatActionMessage(event))
        } catch (cause) {
          console.warn("[widgets] chat fallback failed:", cause)
        }
      }
    }
    return { acked: false, done: Promise.resolve(undefined) }
  }

  const done = Promise.race([
    // The first listener to return data wins. Multiple listeners disagreeing
    // about the new state is a host bug, not something to merge here.
    Promise.all(promises).then((results) =>
      results.find((result) => result !== undefined && result !== null)
    ),
    new Promise<unknown>((_, reject) =>
      setTimeout(() => reject(new AckTimeoutError()), ACK_TIMEOUT_MS)
    ),
  ])

  return { acked: true, done }
}

/** Opens a link action. */
export function openLink(url: string, newTab: boolean): void {
  /*
   * Defence in depth. The schema already rejects unsafe schemes, but this is
   * the actual navigation sink — `location.href` executes `javascript:` — so
   * it never trusts that validation ran.
   */
  if (!isSafeUrl(url)) {
    console.warn("[widgets] blocked unsafe link URL:", url)
    return
  }
  if (newTab) {
    window.open(url, "_blank", "noopener,noreferrer")
  } else {
    window.location.href = url
  }
}

/** Describes what a resolved action needs from the primitive that runs it. */
export type RunActionOptions = {
  action: Action
  widgetId: string
  label?: string
  /** Already-resolved `additionalInputs`, merged with any form values. */
  payload?: Record<string, unknown>
  context?: Record<string, unknown>
  onClose?: () => void
}

/**
 * Runs an action and reports how to reflect it in the UI. Link and close
 * settle immediately; emit and submit carry the host's acknowledgment.
 */
export function runAction({
  action,
  widgetId,
  label,
  payload,
  context,
  onClose,
}: RunActionOptions): DispatchResult {
  switch (action.kind) {
    case "link": {
      // `url` may have been a binding; the caller resolves before this point.
      const url = typeof action.url === "string" ? action.url : ""
      openLink(url, action.newTab)
      return { acked: false, done: Promise.resolve(undefined) }
    }
    case "close":
      onClose?.()
      return { acked: false, done: Promise.resolve(undefined) }
    case "emit":
    case "submit":
      return dispatchWidgetAction({
        widget: widgetId,
        functionName: action.functionName,
        label,
        payload,
        context,
      })
  }
}
