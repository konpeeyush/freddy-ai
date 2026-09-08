/**
 * The production store: Postgres + pgvector, chosen when `DATABASE_URL` is
 * set (see `packages/backend/src/db.ts`). Same `Store` contract as
 * `./sqlite.ts`, same tenant-scoped tables — this is the "same search code
 * later runs on pgvector" the comment atop that file describes.
 *
 * Differences worth knowing about, beyond the obvious network-vs-local one:
 *
 * - `chunks.embedding` is a real `vector(768)` column, not an opaque BLOB —
 *   distance is computed server-side (`<=>`, cosine) rather than by pulling
 *   every vector into Node and brute-forcing it in JS. No ANN index (HNSW)
 *   yet: a plain distance scan matches `SqliteStore`'s current brute-force
 *   behaviour exactly, and is correct at the chunk volumes this project
 *   deals with today. Worth adding once a tenant's chunk count actually
 *   makes a sequential scan show up in latency — not before.
 * - Keyword search uses a generated `tsvector` column + `websearch_to_tsquery`
 *   instead of FTS5. `websearch_to_tsquery` tolerates arbitrary user text
 *   directly, so the manual term-splitting/quoting `SqliteStore.searchKeyword`
 *   does to dodge FTS5 syntax errors isn't needed here.
 * - `chunks` has a real foreign key onto `pages (tenant_id, url)` with
 *   `ON DELETE CASCADE`, so deleting a page's row is enough to drop its
 *   chunks too — no separate FTS table to clean up alongside it either,
 *   since the tsvector is a generated column on `chunks` itself.
 */
import type { Pool, PoolClient } from "pg"

import { DIMENSIONS } from "../embed"
import { groupPagesByOrigin } from "./stats"
import type {
  Chunk,
  EmbeddedChunk,
  Page,
  Scored,
  SourceStats,
  Store,
} from "../types"

type ChunkRow = {
  id: string
  url: string
  title: string
  headings: string[]
  question: string | null
  text: string
  tokens: number
}

/** pgvector's text input format for a vector literal. */
function toVectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`
}

export class PgVectorStore implements Store {
  constructor(private pool: Pool) {}

  /**
   * Not part of the `Store` interface — SQLite's constructor can migrate
   * synchronously, but this needs a network round trip, so `packages/backend`
   * calls this explicitly once at startup instead.
   */
  async migrate(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector")
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pages (
        tenant_id  TEXT NOT NULL,
        url        TEXT NOT NULL,
        title      TEXT NOT NULL,
        hash       TEXT NOT NULL,
        fetched_at BIGINT NOT NULL,
        PRIMARY KEY (tenant_id, url)
      )`)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id        TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        url       TEXT NOT NULL,
        title     TEXT NOT NULL,
        headings  JSONB NOT NULL,
        question  TEXT,
        text      TEXT NOT NULL,
        tokens    INTEGER NOT NULL,
        embedding vector(${DIMENSIONS}) NOT NULL,
        body_tsv  tsvector GENERATED ALWAYS AS (
          to_tsvector('english',
            coalesce(title, '') || ' ' || coalesce(question, '') || ' ' || text)
        ) STORED,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, url)
          REFERENCES pages (tenant_id, url) ON DELETE CASCADE
      )`)
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS chunks_tenant ON chunks (tenant_id, url)"
    )
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS chunks_fts ON chunks USING GIN (body_tsv)"
    )
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS indexes (
        tenant_id       TEXT PRIMARY KEY,
        embedding_model TEXT NOT NULL,
        updated_at      BIGINT NOT NULL
      )`)
  }

  private static toRow(row: ChunkRow): Chunk {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      headings: row.headings, // jsonb round-trips as a JS array already
      question: row.question ?? undefined,
      text: row.text,
      tokens: row.tokens,
    }
  }

  private async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await fn(client)
      await client.query("COMMIT")
      return result
    } catch (cause) {
      await client.query("ROLLBACK")
      throw cause
    } finally {
      client.release()
    }
  }

  async indexModel(tenantId: string): Promise<string | undefined> {
    const result = await this.pool.query<{ embedding_model: string }>(
      "SELECT embedding_model FROM indexes WHERE tenant_id = $1",
      [tenantId]
    )
    return result.rows[0]?.embedding_model
  }

  async setIndexModel(tenantId: string, model: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexes (tenant_id, embedding_model, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         embedding_model = excluded.embedding_model,
         updated_at = excluded.updated_at`,
      [tenantId, model, Date.now()]
    )
  }

  async upsertPage(
    tenantId: string,
    page: Page,
    chunks: EmbeddedChunk[]
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      // Deleting the page row cascades onto its chunks — no separate
      // chunk/FTS cleanup statement needed, unlike the SQLite store.
      await client.query(
        "DELETE FROM pages WHERE tenant_id = $1 AND url = $2",
        [tenantId, page.url]
      )
      await client.query(
        `INSERT INTO pages (tenant_id, url, title, hash, fetched_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, page.url, page.title, page.hash, page.fetchedAt]
      )
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO chunks
             (id, tenant_id, url, title, headings, question, text, tokens, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
          [
            chunk.id,
            tenantId,
            chunk.url,
            chunk.title,
            JSON.stringify(chunk.headings),
            chunk.question ?? null,
            chunk.text,
            chunk.tokens,
            toVectorLiteral(chunk.embedding),
          ]
        )
      }
    })
  }

  async deletePage(tenantId: string, url: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM pages WHERE tenant_id = $1 AND url = $2",
      [tenantId, url]
    )
  }

  async deletePagesByOrigin(tenantId: string, origin: string): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM pages WHERE tenant_id = $1 AND starts_with(url, $2)",
      [tenantId, origin]
    )
    return result.rowCount ?? 0
  }

  async pageHash(tenantId: string, url: string): Promise<string | undefined> {
    const result = await this.pool.query<{ hash: string }>(
      "SELECT hash FROM pages WHERE tenant_id = $1 AND url = $2",
      [tenantId, url]
    )
    return result.rows[0]?.hash
  }

  async removePagesNotIn(tenantId: string, urls: string[]): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM pages WHERE tenant_id = $1 AND url <> ALL($2::text[])",
      [tenantId, urls]
    )
    return result.rowCount ?? 0
  }

  async searchVector(
    tenantId: string,
    query: Float32Array,
    limit: number
  ): Promise<Scored[]> {
    const literal = toVectorLiteral(query)
    const result = await this.pool.query<ChunkRow & { score: number }>(
      `SELECT id, url, title, headings, question, text, tokens,
              1 - (embedding <=> $2::vector) AS score
       FROM chunks
       WHERE tenant_id = $1
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [tenantId, literal, limit]
    )
    return result.rows.map((r) => ({
      chunk: PgVectorStore.toRow(r),
      score: Number(r.score),
    }))
  }

  async searchKeyword(
    tenantId: string,
    query: string,
    limit: number
  ): Promise<Scored[]> {
    /*
     * OR'd terms, not `websearch_to_tsquery`'s default AND — matching
     * `SqliteStore.searchKeyword`'s FTS5 query, which OR's for the same
     * reason: keyword search's job in the hybrid fusion is to catch
     * whichever exact terms it can, not to demand every one of them appear.
     * `websearch_to_tsquery('english', 'refund policy')` requires *both*
     * words and returns nothing for a chunk that only has one of them.
     *
     * Terms are pre-split into plain alphanumeric words before being joined
     * with tsquery's `|` operator, the same defusing `SqliteStore` does
     * before handing anything to FTS5's own query syntax — a raw query
     * routed straight into `to_tsquery` would let `&`, `(`, `:` and friends
     * change what the query means, or throw a syntax error outright.
     */
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2)
      .slice(0, 12)
    if (!terms.length) return []

    try {
      const result = await this.pool.query<ChunkRow & { rank: number }>(
        `SELECT id, url, title, headings, question, text, tokens,
                ts_rank(body_tsv, to_tsquery('english', $2)) AS rank
         FROM chunks
         WHERE tenant_id = $1
           AND body_tsv @@ to_tsquery('english', $2)
         ORDER BY rank DESC
         LIMIT $3`,
        [tenantId, terms.join(" | "), limit]
      )
      return result.rows.map((r) => ({
        chunk: PgVectorStore.toRow(r),
        score: Number(r.rank),
      }))
    } catch {
      // Mirrors SqliteStore.searchKeyword: a query that upsets the keyword
      // side should degrade to vector-only, not fail the whole search.
      return []
    }
  }

  /** One row per (tenant, origin) — see `groupPagesByOrigin` for the
   *  grouping rules this follows. */
  async stats(tenantId?: string): Promise<SourceStats[]> {
    const result = await this.pool.query<{
      tenant_id: string
      url: string
      fetched_at: string
      chunks: string
    }>(
      `SELECT p.tenant_id, p.url, p.fetched_at,
              (SELECT COUNT(*) FROM chunks c
                WHERE c.tenant_id = p.tenant_id AND c.url = p.url) AS chunks
       FROM pages p
       ${tenantId ? "WHERE p.tenant_id = $1" : ""}`,
      tenantId ? [tenantId] : []
    )

    // BIGINT/COUNT(*) come back as strings from `pg` to avoid silent
    // precision loss above 2^53 — converted here, not left for callers.
    const buckets = groupPagesByOrigin(
      result.rows.map((r) => ({
        tenantId: r.tenant_id,
        url: r.url,
        fetchedAt: Number(r.fetched_at),
        chunks: Number(r.chunks),
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
    // Cascades onto chunks, same as a single deletePage.
    await this.pool.query("DELETE FROM pages WHERE tenant_id = $1", [tenantId])
    await this.pool.query("DELETE FROM indexes WHERE tenant_id = $1", [tenantId])
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
