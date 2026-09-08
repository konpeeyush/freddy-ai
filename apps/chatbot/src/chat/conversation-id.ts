/**
 * The visitor's conversation id.
 *
 * Separate from `store.ts`'s transcript key on purpose: the transcript is a
 * local cache the widget can rebuild from the server, while this id is the
 * durable link to the server-side conversation row — losing it would not
 * lose messages already sent, but it would orphan them from any future ones,
 * since the backend has no other way to recognise a returning visitor as the
 * same conversation.
 */
const KEY = "freddy-chat-conversation-id"

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Storage inaccessible (private mode, disabled) — the chat still works,
    // it just starts a fresh conversation id every load.
    return null
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Ignore — see readStored.
  }
}

/** Returns the visitor's existing conversation id, minting one if absent. */
export function getConversationId(): string {
  return readStored() ?? mintConversationId()
}

/** Starts a fresh conversation id, persisting it as the new current one.
 *  Called alongside `clearChat()` on reset — a new transcript needs a new
 *  server-side conversation too, not the old one continued. */
export function mintConversationId(): string {
  const id = crypto.randomUUID()
  writeStored(id)
  return id
}
