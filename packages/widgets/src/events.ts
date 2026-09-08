/*
 * Widget action event bus.
 *
 * Standalone on purpose: primitives emit here, and whatever is hosting them
 * bridges to its own listeners. Keeping the SDK and socket layers out means
 * this module is importable from a dashboard preview or a test without
 * dragging the widget runtime along.
 */

export type WidgetActionEvent = {
  /** Widget definition id the action came from, e.g. "gym_class_booking". */
  widget: string
  /** The function the author named, e.g. "book_class". */
  functionName: string
  /** The clicked control's visitor-facing label, when there is one. */
  label?: string
  /** Resolved `additionalInputs`, plus Form values on a submit. */
  payload?: Record<string, unknown>
  /** Where in the widget it happened — the repeat index, the item key. */
  context?: Record<string, unknown>
}

/**
 * Subscribers may return a promise to acknowledge: the emitting control shows
 * pending until it settles, a success flash on resolve, and the rejection
 * message inline on reject. A synchronous subscriber means no ack, so the
 * control shows a brief flash instead — a click must never feel dead.
 */
type Subscriber = (event: WidgetActionEvent) => unknown

const subscribers = new Set<Subscriber>()

/** Subscribe to widget action events. Returns an unsubscribe function. */
export function onWidgetAction(callback: Subscriber): () => void {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

/** @returns any acknowledgment promises the subscribers returned. */
export function emitWidgetAction(event: WidgetActionEvent): {
  promises: Promise<unknown>[]
} {
  const promises: Promise<unknown>[] = []
  subscribers.forEach((callback) => {
    try {
      const result = callback(event)
      if (result && typeof (result as Promise<unknown>).then === "function") {
        promises.push(result as Promise<unknown>)
      }
    } catch (cause) {
      // A synchronous throw is a rejection too — the control should show it.
      promises.push(Promise.reject(cause))
    }
  })
  return { promises }
}

export function hasWidgetActionListener(): boolean {
  return subscribers.size > 0
}

/*
 * The chat fallback.
 *
 * With no host listener at all, a click becomes a visitor message and the AI
 * handles it. This is what lets someone ship a booking widget without their
 * developer writing a line of JavaScript, so it is the default rather than an
 * opt-in. The host wires this once at mount.
 */
type ChatSender = (text: string) => void

let chatSender: ChatSender | null = null

export function setWidgetChatSender(sender: ChatSender | null): void {
  chatSender = sender
}

export function getWidgetChatSender(): ChatSender | null {
  return chatSender
}
