import { ChatMessageSchema, type ChatMessage } from "@workspace/api"

/*
 * Conversation storage.
 *
 * Two functions — `loadChat` and `saveChat` — matching the shape the AI SDK's
 * persistence guide uses, because the interesting property of that guide is
 * that storage is pluggable: everything else is the same whether the messages
 * end up in a database or here.
 *
 * Here is the visitor's own browser. The server is stateless and has no auth,
 * so a chat it could load by id would be readable by anyone holding that id.
 * Keeping the transcript on the device that produced it needs no such gate,
 * and it is coherent with the rest of the design — the page defines the tools,
 * so the page can hold the conversation that used them.
 *
 * The cost is honest: this does not follow a visitor to another device, and it
 * goes when they clear site data. Moving to a server store later means
 * replacing these two functions and nothing else.
 */

const KEY = "freddy-chat-conversation"

/**
 * Messages kept per conversation.
 *
 * A cap rather than unbounded growth: `localStorage` is a few megabytes and
 * shared with the host page, so a long-running chat must not be the thing that
 * fills it. The oldest are dropped, since a transcript reads from the end.
 */
export const MAX_STORED_MESSAGES = 100

/** Storage that is present but refuses to write — Safari's private mode. */
function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Access itself throws when site data is blocked.
    return null
  }
}

/**
 * Reads the stored conversation.
 *
 * Every message is validated on the way out. Stored data outlives the code
 * that wrote it: a message written by an older version may not match the
 * current schema, and one bad entry should cost that entry rather than the
 * whole history. This is the local equivalent of the guide's
 * `validateUIMessages` step, which exists for the same reason.
 */
export function loadChat(): ChatMessage[] {
  const store = storage()
  if (!store) return []

  try {
    const raw = store.getItem(KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const messages: ChatMessage[] = []
    for (const entry of parsed) {
      const result = ChatMessageSchema.safeParse(entry)
      if (result.success) messages.push(result.data)
    }

    if (messages.length !== parsed.length) {
      console.warn(
        `[chat] dropped ${parsed.length - messages.length} stored message(s) ` +
          `that no longer match the schema`
      )
    }
    return messages
  } catch {
    // Corrupt JSON. Starting fresh beats failing to open the widget.
    return []
  }
}

/**
 * Writes the conversation.
 *
 * Called after a turn settles rather than on every token: the in-flight reply
 * is React state precisely so it does not hit a store on each chunk, and a
 * partial reply is not something worth restoring.
 */
export function saveChat(messages: ChatMessage[]): void {
  const store = storage()
  if (!store) return

  const trimmed =
    messages.length > MAX_STORED_MESSAGES
      ? messages.slice(-MAX_STORED_MESSAGES)
      : messages

  /*
   * Quota is the failure worth handling: a widget conversation is small, but
   * it shares an origin with whatever the host page stores, so there may be
   * very little room. Shrink toward the recent turns rather than losing the
   * conversation outright — a transcript is read from the end.
   *
   * Progressive rather than one fixed-size retry, because how much fits is
   * not knowable here: a turn carrying a widget payload is far larger than a
   * line of prose.
   */
  for (const size of [trimmed.length, 20, 10, 4, 1]) {
    if (size > trimmed.length) continue
    try {
      store.setItem(KEY, JSON.stringify(trimmed.slice(-size)))
      return
    } catch {
      // Try a shorter tail.
    }
  }

  /*
   * Nothing fit. Clear our own key rather than leaving a stale transcript
   * that would load as though it were current.
   */
  try {
    store.removeItem(KEY)
  } catch {
    // The conversation still works in memory.
  }
}

/** Forgets the conversation. */
export function clearChat(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // Ignored for the same reason as above.
  }
}
