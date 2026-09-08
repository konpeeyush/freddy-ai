import Database from "better-sqlite3"
import { SqliteStore } from "@workspace/rag"

/**
 * One sqlite file for the whole backend.
 *
 * `SqliteStore` owns the RAG tables (`pages`/`chunks`/`indexes`/`chunk_fts`);
 * the tables below are this app's own, sharing the same file rather than a
 * second one — a document upload and the knowledge-base search it feeds both
 * belong to the same tenant, and there is no reason to juggle two connections
 * to look at data that is conceptually one store.
 */
export const sqlite = new Database(process.env.DB_PATH ?? "freddy.db")
sqlite.pragma("journal_mode = WAL")

export const store = new SqliteStore(sqlite)

function migrateAppTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT NOT NULL,
      tenant_id   TEXT NOT NULL,
      filename    TEXT NOT NULL,
      category    TEXT,
      source      TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL,
      status      TEXT NOT NULL,
      error       TEXT,
      page_url    TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`)
  db.exec(
    "CREATE INDEX IF NOT EXISTS documents_tenant ON documents (tenant_id, created_at)"
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id                   TEXT NOT NULL,
      tenant_id            TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'unresolved',
      visitor_name         TEXT,
      visitor_meta         TEXT,
      last_message_preview TEXT,
      last_message_at      INTEGER,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    )`)
  db.exec(
    "CREATE INDEX IF NOT EXISTS conversations_tenant_status ON conversations (tenant_id, status, updated_at)"
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      tenant_id       TEXT NOT NULL,
      role            TEXT NOT NULL,
      sender          TEXT NOT NULL,
      text            TEXT NOT NULL,
      parts           TEXT,
      sources         TEXT,
      created_at      INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, conversation_id, id)
    )`)
  db.exec(
    "CREATE INDEX IF NOT EXISTS messages_conversation ON messages (tenant_id, conversation_id, created_at)"
  )
}

migrateAppTables(sqlite)
