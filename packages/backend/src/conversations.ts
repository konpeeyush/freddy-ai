import type { DbAdapter } from "./adapter"

import type {
  ConversationStatus,
  MessagePart,
  MessageSender,
  MessageSource,
  Role,
  VisitorMeta,
} from "@workspace/api/schema"

/*
 * Conversation and message persistence.
 *
 * The one part of this backend that isn't a port of chatbot-sdk's server —
 * that server is stateless by design, trusting only the history a `/chat`
 * request carries. This layers structure on top of it additively: the widget
 * calls `appendMessage` at the same commit points it already writes to its
 * own localStorage, so a conversation becomes visible in the dashboard
 * without `/chat` itself changing at all.
 */

export type ConversationRow = {
  id: string
  tenant_id: string
  status: ConversationStatus
  visitor_name: string | null
  visitor_meta: string | null
  last_message_preview: string | null
  last_message_at: number | null
  created_at: number
  updated_at: number
}

export type MessageRow = {
  id: string
  conversation_id: string
  tenant_id: string
  role: Role
  sender: MessageSender
  text: string
  parts: string | null
  sources: string | null
  created_at: number
}

/** Beyond this the inbox's row-preview stops being a preview. */
const PREVIEW_LENGTH = 140

function preview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > PREVIEW_LENGTH
    ? `${trimmed.slice(0, PREVIEW_LENGTH)}…`
    : trimmed
}

function encodeCursor(updatedAt: number, id: string): string {
  return Buffer.from(`${updatedAt}:${id}`, "utf-8").toString("base64url")
}

function decodeCursor(cursor: string): { updatedAt: number; id: string } {
  const [ts, ...rest] = Buffer.from(cursor, "base64url")
    .toString("utf-8")
    .split(":")
  return { updatedAt: Number(ts), id: rest.join(":") }
}

export async function getConversation(
  db: DbAdapter,
  tenantId: string,
  id: string
): Promise<ConversationRow | undefined> {
  return db.get<ConversationRow>(
    "SELECT * FROM conversations WHERE tenant_id = ? AND id = ?",
    [tenantId, id]
  )
}

export async function listConversations(
  db: DbAdapter,
  tenantId: string,
  options: { status?: ConversationStatus; cursor?: string; limit: number }
): Promise<{ items: ConversationRow[]; nextCursor?: string }> {
  const conditions = ["tenant_id = ?"]
  const params: (string | number)[] = [tenantId]

  if (options.status) {
    conditions.push("status = ?")
    params.push(options.status)
  }

  if (options.cursor) {
    const { updatedAt, id } = decodeCursor(options.cursor)
    conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))")
    params.push(updatedAt, updatedAt, id)
  }

  // One extra row fetched, never returned, purely to know whether a next
  // page exists without a second COUNT query.
  const rows = await db.all<ConversationRow>(
    `SELECT * FROM conversations WHERE ${conditions.join(" AND ")}
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
    [...params, options.limit + 1]
  )

  const hasMore = rows.length > options.limit
  const items = hasMore ? rows.slice(0, options.limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : undefined,
  }
}

export async function updateConversationStatus(
  db: DbAdapter,
  tenantId: string,
  id: string,
  status: ConversationStatus
): Promise<boolean> {
  const result = await db.run(
    "UPDATE conversations SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
    [status, Date.now(), tenantId, id]
  )
  return result.changes > 0
}

export async function getMessagesSince(
  db: DbAdapter,
  tenantId: string,
  conversationId: string,
  after?: number
): Promise<MessageRow[]> {
  if (after !== undefined) {
    return db.all<MessageRow>(
      `SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ?
       AND created_at > ? ORDER BY created_at ASC`,
      [tenantId, conversationId, after]
    )
  }
  return db.all<MessageRow>(
    `SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ?
     ORDER BY created_at ASC`,
    [tenantId, conversationId]
  )
}

/**
 * Appends one message, lazily creating the conversation on first contact.
 *
 * Idempotent on `message.id`: a retried append (the widget's fire-and-forget
 * call failing to confirm, then trying again) inserts the same row once, not
 * twice — `ON CONFLICT DO NOTHING` rather than an update, since a message,
 * once sent, never changes.
 */
export async function appendMessage(
  db: DbAdapter,
  tenantId: string,
  conversationId: string,
  message: {
    id: string
    role: Role
    sender: MessageSender
    text: string
    parts?: MessagePart[]
    sources?: MessageSource[]
    createdAt?: number
  },
  visitorMeta?: VisitorMeta
): Promise<ConversationRow> {
  const now = Date.now()
  const createdAt = message.createdAt ?? now

  await db.run(
    `INSERT INTO conversations
       (id, tenant_id, status, visitor_meta, last_message_preview, last_message_at, created_at, updated_at)
     VALUES (?, ?, 'unresolved', ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, id) DO UPDATE SET
       last_message_preview = excluded.last_message_preview,
       last_message_at = excluded.last_message_at,
       updated_at = excluded.updated_at,
       -- Refreshed when a later message brings a newer one (the visitor
       -- navigated to a different page mid-conversation), kept otherwise.
       visitor_meta = COALESCE(excluded.visitor_meta, conversations.visitor_meta)`,
    [
      conversationId,
      tenantId,
      visitorMeta ? JSON.stringify(visitorMeta) : null,
      preview(message.text),
      createdAt,
      now,
      now,
    ]
  )

  await db.run(
    `INSERT INTO messages
       (id, conversation_id, tenant_id, role, sender, text, parts, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, conversation_id, id) DO NOTHING`,
    [
      message.id,
      conversationId,
      tenantId,
      message.role,
      message.sender,
      message.text,
      message.parts ? JSON.stringify(message.parts) : null,
      message.sources ? JSON.stringify(message.sources) : null,
      createdAt,
    ]
  )

  // Re-read rather than constructed in memory: the row above may have hit
  // the UPDATE branch, so this is the authoritative post-write state.
  return (await getConversation(db, tenantId, conversationId))!
}
