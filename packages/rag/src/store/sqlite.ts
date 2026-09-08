/**
 * The dev-grade store: better-sqlite3 for durability, FTS5 for keyword
 * search, and brute-force cosine in JavaScript for vectors.
 *
 * No pgvector, and no sqlite-vec either. sqlite-vec is a loadable extension,
 * and macOS ships a system SQLite compiled without extension support — so
 * using it means telling every developer to install SQLite from Homebrew and
 * wire up extension loading before the app will start. For a harness whose
 * whole promise is "clone it and run it", that trade is wrong. better-sqlite3
 * ships its own bundled SQLite (with FTS5 compiled in), which sidesteps that
 * entirely — no system SQLite involved.
 *
 * Brute force is also just fine at this size. A docs site is a few thousand
 * chunks; 5,000 dot products over 768 floats is around a millisecond, which is
 * noise next to the embedding round trip that precedes it. The moment this
 * outgrows that, `Store` is the seam — see `../types`.
 *
 * FTS5 does the keyword half and is built into better-sqlite3's bundled
 * SQLite, which is what makes hybrid search free here rather than a second
 * dependency.
 */
import Database from "better-sqlite3"

import { similarity } from "../embed"
import type {
  Chunk,
  EmbeddedChunk,
  Page,
  Scored,
  SourceStats,
  Store,
} from "../types"
import { groupPagesByOrigin } from "./stats"

type ChunkRow = {
  id: string
  url: string
  title: string
  headings: string
  question: string | null
  text: string
  tokens: number
}

/** The searchable half of a tenant's chunks, held in memory. */
type Index = { ids: string[]; vectors: Float32Array[] }

export class SqliteStore implements Store {
  private db: Database.Database
  /** Rebuilt lazily, dropped on write. Reading every blob back out of SQLite
   *  on each query is the one thing that would make brute force too slow. */
  private indexes = new Map<string, Index>()

  /**
   * Takes either a path (opens its own connection) or an already-open
   * `Database.Database` — the latter is how `packages/backend` shares one
   * sqlite file between this store's tables and the app's own
   * conversations/documents tables, rather than juggling two connections to
   * two files.
   */
  constructor(dbOrPath: string | Database.Database = "rag.db") {
    this.db = typeof dbOrPath === "string" ? new Database(dbOrPath) : dbOrPath
    // WAL so an ingest writing pages does not block the dashboard's search
    // reads — they run concurrently by design.
    this.db.pragma("journal_mode = WAL")
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        tenant_id  TEXT NOT NULL,
        url        TEXT NOT NULL,
        title      TEXT NOT NULL,
        hash       TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, url)
      )`)
    this.rebuildStaleChunks()
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id        TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        url       TEXT NOT NULL,
        title     TEXT NOT NULL,
        headings  TEXT NOT NULL,
        question  TEXT,
        text      TEXT NOT NULL,
        tokens    INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        -- Keyed by tenant AND id, not by id alone. A chunk id is
        -- url#position: unique within a page, but saying nothing about who is
        -- indexing it -- and two customers may perfectly well index the same
        -- public documentation site. With id as the sole primary key, the
        -- second one to ingest it failed on a UNIQUE constraint, which reads
        -- as corruption rather than as the namespacing working.
        PRIMARY KEY (tenant_id, id)
      )`)
    // Scoped by tenant on purpose: every read filters by it, and a shared
    // index that did not would degrade as more customers were added.
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS chunks_tenant ON chunks (tenant_id, url)"
    )
    // Which model's vectors a namespace holds. One row per tenant.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexes (
        tenant_id       TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL,
        updated_at      INTEGER NOT NULL
      )`)
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        chunk_id UNINDEXED,
        tenant_id UNINDEXED,
        body,
        tokenize = 'porter unicode61'
      )`)
  }

  /**
   * Widens an existing `chunks` table's primary key from `id` alone to
   * `(tenant_id, id)`, if it still has the old one.
   *
   * `CREATE TABLE IF NOT EXISTS` below is a no-op once the table exists, so a
   * database created before `chunks` gained its tenant-scoped key stayed on
   * the old, single-column one forever — exactly the collision the comment
   * on that `PRIMARY KEY` describes ("the second one to ingest it failed on
   * a UNIQUE constraint"), just still happening to anyone whose database
   * predates the fix. SQLite has no `ALTER TABLE ... DROP CONSTRAINT`, so
   * this rebuilds the table under the new definition and copies every row
   * across rather than losing whatever was already ingested.
   */
  private rebuildStaleChunks(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all() as { name: string; pk: number }[]
    if (!columns.length) return // First run: the CREATE TABLE below makes it.

    // The old schema's sole primary key column was `id` (pk index 1);
    // `tenant_id` was an ordinary column (pk index 0). The current schema's
    // composite key numbers them the other way around — `tenant_id` first.
    const stale = columns.some((c) => c.name === "id" && c.pk === 1)
    if (!stale) return

    console.warn(
      "rag store: widening chunks' primary key to (tenant_id, id) " +
        "— one-time migration of an existing database"
    )
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE chunks_migrated (
          id        TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          url       TEXT NOT NULL,
          title     TEXT NOT NULL,
          headings  TEXT NOT NULL,
          question  TEXT,
          text      TEXT NOT NULL,
          tokens    INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          PRIMARY KEY (tenant_id, id)
        )`)
      this.db.exec(`
        INSERT INTO chunks_migrated
          (id, tenant_id, url, title, headings, question, text, tokens, embedding)
        SELECT id, tenant_id, url, title, headings, question, text, tokens, embedding
        FROM chunks`)
      this.db.exec("DROP TABLE chunks")
      this.db.exec("ALTER TABLE chunks_migrated RENAME TO chunks")
    })()
  }

  private static toRow(row: ChunkRow): Chunk {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      headings: JSON.parse(row.headings) as string[],
      question: row.question ?? undefined,
      text: row.text,
      tokens: row.tokens,
    }
  }

  async indexModel(tenantId: string): Promise<string | undefined> {
    const row = this.db
      .prepare("SELECT embedding_model FROM indexes WHERE tenant_id = ?")
      .get(tenantId) as { embedding_model: string } | undefined
    return row?.embedding_model
  }

  async setIndexModel(tenantId: string, model: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO indexes (tenant_id, embedding_model, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (tenant_id) DO UPDATE SET
           embedding_model = excluded.embedding_model,
           updated_at = excluded.updated_at`
      )
      .run(tenantId, model, Date.now())
  }

  async upsertPage(
    tenantId: string,
    page: Page,
    chunks: EmbeddedChunk[]
  ): Promise<void> {
    // One transaction: a half-written page would leave chunks pointing at a
    // hash that says they are current, and the next ingest would skip it.
    this.db.transaction(() => {
      this.deletePageSync(tenantId, page.url)
      this.db
        .prepare(
          `INSERT INTO pages (tenant_id, url, title, hash, fetched_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(tenantId, page.url, page.title, page.hash, page.fetchedAt)
      const insertChunk = this.db.prepare(
        `INSERT INTO chunks
           (id, tenant_id, url, title, headings, question, text, tokens, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertFts = this.db.prepare(
        "INSERT INTO chunk_fts (chunk_id, tenant_id, body) VALUES (?, ?, ?)"
      )
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          tenantId,
          chunk.url,
          chunk.title,
          JSON.stringify(chunk.headings),
          chunk.question ?? null,
          chunk.text,
          chunk.tokens,
          // Float32Array's buffer goes in as a blob and comes back as one, so
          // the vector round-trips without a JSON parse per chunk per query.
          Buffer.from(
            chunk.embedding.buffer,
            chunk.embedding.byteOffset,
            chunk.embedding.byteLength
          )
        )
        // The heading path is indexed for keyword search as well as embedded.
        // Someone searching "refund" should match a section *titled* Refunds
        // even when the body never repeats the word.
        insertFts.run(
          chunk.id,
          tenantId,
          [chunk.title, ...chunk.headings, chunk.question ?? "", chunk.text]
            .filter(Boolean)
            .join("\n")
        )
      }
    })()
    this.indexes.delete(tenantId)
  }

  /**
   * The synchronous body every deletion path shares. Kept private and
   * separate from the public, async `deletePage` so it can be called
   * straight from inside a `this.db.transaction(...)` callback — those must
   * stay synchronous for better-sqlite3, and awaiting the public method
   * there would just be awaiting an already-resolved promise around the
   * same synchronous work, for no benefit.
   */
  private deletePageSync(tenantId: string, url: string): void {
    this.db
      .prepare(
        `DELETE FROM chunk_fts WHERE tenant_id = ? AND chunk_id IN
           (SELECT id FROM chunks WHERE tenant_id = ? AND url = ?)`
      )
      .run(tenantId, tenantId, url)
    this.db
      .prepare("DELETE FROM chunks WHERE tenant_id = ? AND url = ?")
      .run(tenantId, url)
    this.db
      .prepare("DELETE FROM pages WHERE tenant_id = ? AND url = ?")
      .run(tenantId, url)
  }

  /**
   * Public so `packages/backend`'s document-delete endpoint can remove a
   * single upload's chunks directly, without going through the crawl-pruning
   * path (`removePagesNotIn`) or wiping the whole tenant (`clear`).
   */
  async deletePage(tenantId: string, url: string): Promise<void> {
    this.deletePageSync(tenantId, url)
    this.indexes.delete(tenantId)
  }

  /** Removes every page under one crawled site in a single transaction —
   *  the Links dashboard's per-source delete. */
  async deletePagesByOrigin(tenantId: string, origin: string): Promise<number> {
    const existing = this.db
      .prepare("SELECT url FROM pages WHERE tenant_id = ?")
      .all(tenantId) as { url: string }[]
    const matching = existing.filter(({ url }) => url.startsWith(origin))
    if (!matching.length) return 0

    this.db.transaction(() => {
      for (const { url } of matching) this.deletePageSync(tenantId, url)
    })()
    this.indexes.delete(tenantId)
    return matching.length
  }

  async pageHash(tenantId: string, url: string): Promise<string | undefined> {
    const row = this.db
      .prepare("SELECT hash FROM pages WHERE tenant_id = ? AND url = ?")
      .get(tenantId, url) as { hash: string } | undefined
    return row?.hash
  }

  async removePagesNotIn(tenantId: string, urls: string[]): Promise<number> {
    const keep = new Set(urls)
    const existing = this.db
      .prepare("SELECT url FROM pages WHERE tenant_id = ?")
      .all(tenantId) as { url: string }[]
    const stale = existing.filter(({ url }) => !keep.has(url))
    if (!stale.length) return 0

    // One transaction rather than 3 auto-committed statements per page: a
    // refresh that prunes hundreds of pages otherwise pays a WAL fsync per
    // statement instead of per run, the same reasoning `upsertPage` follows.
    this.db.transaction(() => {
      for (const { url } of stale) this.deletePageSync(tenantId, url)
    })()
    this.indexes.delete(tenantId)
    return stale.length
  }

  private index(tenantId: string): Index {
    const cached = this.indexes.get(tenantId)
    if (cached) return cached
    const rows = this.db
      .prepare("SELECT id, embedding FROM chunks WHERE tenant_id = ?")
      .all(tenantId) as { id: string; embedding: Buffer }[]
    const index: Index = {
      ids: rows.map((r) => r.id),
      vectors: rows.map(
        (r) =>
          new Float32Array(
            r.embedding.buffer.slice(
              r.embedding.byteOffset,
              r.embedding.byteOffset + r.embedding.byteLength
            )
          )
      ),
    }
    this.indexes.set(tenantId, index)
    return index
  }

  async searchVector(
    tenantId: string,
    query: Float32Array,
    limit: number
  ): Promise<Scored[]> {
    const { ids, vectors } = this.index(tenantId)
    const scored: { id: string; score: number }[] = []
    for (let i = 0; i < ids.length; i++) {
      scored.push({ id: ids[i]!, score: similarity(query, vectors[i]!) })
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)
    if (!top.length) return []

    // Scoped by tenant as well as id: ids are only unique within a namespace,
    // so an unscoped `IN` would pull another tenant's identically-named chunk.
    const rows = this.db
      .prepare(
        `SELECT id, url, title, headings, question, text, tokens FROM chunks
         WHERE tenant_id = ? AND id IN (${top.map(() => "?").join(",")})`
      )
      .all(tenantId, ...top.map((t) => t.id)) as ChunkRow[]
    const byId = new Map(rows.map((r) => [r.id, SqliteStore.toRow(r)]))
    return top
      .filter((t) => byId.has(t.id))
      .map((t) => ({ chunk: byId.get(t.id)!, score: t.score }))
  }

  async searchKeyword(
    tenantId: string,
    query: string,
    limit: number
  ): Promise<Scored[]> {
    // FTS5 has its own query syntax, and a visitor's question is not written
    // in it — an apostrophe or a stray `*` is a syntax error, not a search.
    // Reduced to quoted terms OR'd together, which is what a question means.
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
      .slice(0, 12)
      .map((t) => `"${t}"`)
    if (!terms.length) return []

    try {
      const rows = this.db
        .prepare(
          `SELECT c.id, c.url, c.title, c.headings, c.question, c.text, c.tokens,
                  bm25(chunk_fts) AS rank
           FROM chunk_fts
           JOIN chunks c
             ON c.id = chunk_fts.chunk_id
            AND c.tenant_id = chunk_fts.tenant_id
           WHERE chunk_fts MATCH ? AND chunk_fts.tenant_id = ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(terms.join(" OR "), tenantId, limit) as (ChunkRow & {
        rank: number
      })[]
      // bm25() is negative, most relevant first. Negated so a bigger number is
      // better here too, matching the vector side.
      return rows.map((r) => ({ chunk: SqliteStore.toRow(r), score: -r.rank }))
    } catch {
      // A query that still upsets FTS5 should degrade to vector-only, not
      // fail the whole search.
      return []
    }
  }

  /** One row per (tenant, origin) — see `groupPagesByOrigin` for the
   *  grouping rules this follows. */
  async stats(tenantId?: string): Promise<SourceStats[]> {
    const rows = this.db
      .prepare(
        `SELECT p.tenant_id, p.url, p.fetched_at,
                (SELECT COUNT(*) FROM chunks c WHERE c.tenant_id = p.tenant_id AND c.url = p.url) AS chunks
         FROM pages p
         ${tenantId ? "WHERE p.tenant_id = ?" : ""}`
      )
      .all(...(tenantId ? [tenantId] : [])) as {
      tenant_id: string
      url: string
      fetched_at: number
      chunks: number
    }[]

    const buckets = groupPagesByOrigin(
      rows.map((r) => ({
        tenantId: r.tenant_id,
        url: r.url,
        fetchedAt: r.fetched_at,
        chunks: r.chunks,
      }))
    )

    const out: SourceStats[] = []
    for (const bucket of buckets) {
      out.push({
        ...bucket,
        embeddingModel: await this.indexModel(bucket.tenantId),
      })
    }
    return out
  }

  async clear(tenantId: string): Promise<void> {
    this.db.prepare("DELETE FROM chunk_fts WHERE tenant_id = ?").run(tenantId)
    this.db.prepare("DELETE FROM chunks WHERE tenant_id = ?").run(tenantId)
    this.db.prepare("DELETE FROM pages WHERE tenant_id = ?").run(tenantId)
    // Dropped with the vectors it describes: an empty namespace is not bound
    // to the model that last filled it, and keeping the row would reject the
    // next ingest for no reason.
    this.db.prepare("DELETE FROM indexes WHERE tenant_id = ?").run(tenantId)
    this.indexes.delete(tenantId)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
