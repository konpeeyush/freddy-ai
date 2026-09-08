/**
 * The primitive `documents.ts`/`conversations.ts` run their SQL through,
 * instead of calling `better-sqlite3` directly. Two implementations —
 * `SqliteAdapter`, `PgAdapter` — selected once in `./db` based on whether
 * `DATABASE_URL` is set.
 *
 * Deliberately thin: just `get`/`all`/`run`, not a `Store`-style seam with
 * one implementation per engine. The queries in `documents.ts`/
 * `conversations.ts` are simple CRUD/upsert and read almost identically on
 * both engines (Postgres accepts the same `ON CONFLICT (...) DO UPDATE SET
 * col = excluded.col` syntax SQLite uses) — only placeholder style (`?` vs
 * `$1`) and sync-vs-async calling convention differ, which is exactly what
 * this absorbs. No `transaction()` method: neither `documents.ts` nor
 * `conversations.ts` currently wraps its writes in one (only
 * `packages/rag`'s store does, and that stays inside `SqliteStore`/
 * `PgVectorStore` themselves) — adding one here speculatively would also be
 * genuinely unsafe for SQLite, since `better-sqlite3`'s `.transaction()`
 * callback must run fully synchronously, which an `async` callback threaded
 * through `await`s on this adapter cannot guarantee.
 */
import type Database from "better-sqlite3"
import type { Pool } from "pg"

export interface DbAdapter {
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
}

export class SqliteAdapter implements DbAdapter {
  constructor(private db: Database.Database) {}

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[]
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = this.db.prepare(sql).run(...params)
    return { changes: result.changes }
  }
}

/** Rewrites `?` placeholders to Postgres' `$1, $2, ...`, in order.
 *  Safe here because none of this backend's SQL text contains a literal
 *  `?` character inside a string/JSON literal — every `?` is a placeholder. */
function toPositional(sql: string): string {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

export class PgAdapter implements DbAdapter {
  constructor(private pool: Pool) {}

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.pool.query(toPositional(sql), params)
    return result.rows[0] as T | undefined
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(toPositional(sql), params)
    return result.rows as T[]
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await this.pool.query(toPositional(sql), params)
    return { changes: result.rowCount ?? 0 }
  }
}
