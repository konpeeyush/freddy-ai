import Database from "better-sqlite3"
import { Pool, types } from "pg"
import { PgVectorStore, SqliteStore, type Store } from "@workspace/rag"

import { PgAdapter, SqliteAdapter, type DbAdapter } from "./adapter"

/**
 * `pg` returns BIGINT (OID 20) as a string by default, to avoid silently
 * losing precision above 2^53 — but every BIGINT column in this schema
 * holds an epoch-millisecond timestamp or a small count, nowhere near that
 * bound, and the wire contract (`@workspace/api`'s `DocumentSchema` et al.)
 * declares them as plain numbers. Parsing them back to numbers once, here,
 * beats converting the same field in every row mapper across
 * `documents.ts`/`conversations.ts`/`index.ts`'s `toDocument`/
 * `toConversation`/`toStoredMessage`.
 */
types.setTypeParser(20, (value) => parseInt(value, 10))

/**
 * One database for the whole backend — RAG chunks/pages/vectors *and* this
 * app's own documents/conversations/messages tables — picked once here by
 * whether `DATABASE_URL` is set.
 *
 * Local dev with nothing set stays exactly as it always has: the
 * zero-config `better-sqlite3` file. Setting `DATABASE_URL` opts a
 * deployment into Postgres+pgvector for *both* halves at once — not just
 * RAG chunks with the app's own tables left behind on SQLite, which would
 * leave a production deployment split across two databases with two
 * separate durability/backup stories for no reason. See `SqliteStore`'s
 * and `PgVectorStore`'s own file comments (`@workspace/rag`) for what
 * differs between the two on the RAG side.
 */
const databaseUrl = process.env.DATABASE_URL

export let db: DbAdapter
export let store: Store

if (databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl })
  db = new PgAdapter(pool)
  const pgStore = new PgVectorStore(pool)
  await pgStore.migrate()
  store = pgStore
} else {
  const sqlite = new Database(process.env.DB_PATH ?? "freddy.db")
  sqlite.pragma("journal_mode = WAL")
  db = new SqliteAdapter(sqlite)
  store = new SqliteStore(sqlite)
}

/**
 * `documents`/`conversations`/`messages` — this app's own tables, sharing
 * whichever database `store` above just picked rather than a second
 * connection to a second one.
 *
 * One shared statement body per table, not two full copies: Postgres and
 * SQLite disagree only on the epoch-millisecond timestamp columns —
 * SQLite's untyped `INTEGER` storage class is already 64-bit, but Postgres'
 * real `INTEGER` is 32-bit and overflows on `Date.now()` well before the
 * year 2038, so those columns need `BIGINT` there specifically.
 */
async function migrateAppTables(): Promise<void> {
  const ts = databaseUrl ? "BIGINT" : "INTEGER"

  await db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT NOT NULL,
      tenant_id   TEXT NOT NULL,
      filename    TEXT NOT NULL,
      category    TEXT,
      source      TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  ${ts} NOT NULL,
      status      TEXT NOT NULL,
      error       TEXT,
      page_url    TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at  ${ts} NOT NULL,
      updated_at  ${ts} NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`)
  await db.run(
    "CREATE INDEX IF NOT EXISTS documents_tenant ON documents (tenant_id, created_at)"
  )

  await db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                   TEXT NOT NULL,
      tenant_id            TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'unresolved',
      visitor_name         TEXT,
      visitor_meta         TEXT,
      last_message_preview TEXT,
      last_message_at      ${ts},
      created_at           ${ts} NOT NULL,
      updated_at           ${ts} NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`)
  await db.run(
    "CREATE INDEX IF NOT EXISTS conversations_tenant_status ON conversations (tenant_id, status, updated_at)"
  )

  await db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      tenant_id       TEXT NOT NULL,
      role            TEXT NOT NULL,
      sender          TEXT NOT NULL,
      text            TEXT NOT NULL,
      parts           TEXT,
      sources         TEXT,
      created_at      ${ts} NOT NULL,
      PRIMARY KEY (tenant_id, conversation_id, id)
    )`)
  await db.run(
    "CREATE INDEX IF NOT EXISTS messages_conversation ON messages (tenant_id, conversation_id, created_at)"
  )

  await db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      tenant_id    TEXT PRIMARY KEY,
      persona      TEXT NOT NULL DEFAULT '',
      restrictions TEXT NOT NULL DEFAULT '',
      updated_at   ${ts} NOT NULL
    )`)
}

await migrateAppTables()
