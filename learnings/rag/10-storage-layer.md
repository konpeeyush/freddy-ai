# Storage Layer — SQLite vs pgvector
_Two different databases hidden behind one `Store` interface — SQLite in dev, Postgres at scale._

## What is this?

The RAG pipeline (crawl → extract → chunk → embed → **store**) has to save chunks and their embeddings (a vector — the numeric representation of text) somewhere, and search them later. `packages/rag/src/types.ts` has a `Store` interface that only defines the contract — no implementation. Two classes implement it: `SqliteStore` (dev/default, on better-sqlite3) and `PgVectorStore` (production scale, on Postgres + pgvector).

## Why it exists

The rest of the pipeline — `ingest.ts` and `search.ts` — never talks to SQLite or Postgres directly, only to the `Store` interface (both take a `store: Store` — `search.ts:80`, `ingest.ts:49`). `types.ts:1-9` says it itself:

> `Store` exists so the dev harness can run on SQLite with nothing installed while the same search code later runs on pgvector. Everything above it — crawl, extract, chunk, embed, search — is written against this interface and has never heard of either.

Meaning: to swap the DB you write one new class, and don't change a single line of `search.ts` or `ingest.ts`.

The second decision: `sqlite-vec` (SQLite's loadable vector extension) wasn't used for the dev store. The comment at `sqlite.ts:5-11` says why, directly:

> macOS ships a system SQLite compiled without extension support — so using it means telling every developer to install SQLite from Homebrew and wire up extension loading before the app will start. For a harness whose whole promise is "clone it and run it", that trade is wrong.

Hence `better-sqlite3` — it brings its own bundled SQLite binary, with FTS5 (keyword search) already compiled in. That's what makes hybrid search (vector + keyword) come "for free".

## How it works, step by step

1. **The decision at startup.** `db.ts:33-49` checks whether `DATABASE_URL` is set. If not — `new SqliteStore(sqlite)`. If yes — `new PgVectorStore(pool)` + `await pgStore.migrate()`. In both cases the `store` variable is typed as just `Store`.

2. **Ingest (`upsertPage`).** After a page is crawled, chunked, and embedded, `store.upsertPage()` is called — old chunks deleted, new ones inserted, inside one transaction (SQLite: `db.transaction()`, `sqlite.ts:211`; Postgres: `BEGIN`/`COMMIT`, `pgvector.ts:158`).

3. **Embedding storage.** In SQLite the `Float32Array`'s buffer becomes a raw `BLOB` directly (`sqlite.ts:239-243`). In Postgres it's a real `vector(768)` typed column, in the `[0.1,0.2,...]` text-literal format (`toVectorLiteral`, `pgvector.ts:49-51`).

4. **Vector search — the biggest difference.** `SqliteStore.searchVector` (`sqlite.ts:356-382`) loads all of the tenant's vectors into memory and computes cosine `similarity()` in a JS loop — brute force, no index. `PgVectorStore.searchVector` (`pgvector.ts:222-241`) gets the same work done inside Postgres with `ORDER BY embedding <=> $2::vector` — server-side, though that too is still a sequential scan today; there's no ANN index (HNSW).

5. **Keyword search in both.** In SQLite it's FTS5 + `bm25()` (`sqlite.ts:384-424`); in Postgres a generated `tsvector` + GIN index + `ts_rank` (`pgvector.ts:243-289`). Both split the query into words joined with `OR`, so special characters can't break the syntax and a single matching term still returns results.

6. **An in-memory cache (SQLite only).** Deserializing BLOBs on every query would be the slow step — so a `Map<tenantId, Index>` cache is built lazily (`sqlite.ts:334-354`) and dropped on any write (`this.indexes.delete(tenantId)`).

7. **WAL mode is on in both places** (`sqlite.ts:65`, `db.ts:46`) — so an ingest's write doesn't block a search's read; the two can run concurrently.

8. **One file, two purposes.** `SqliteStore`'s constructor can also take an already-open `Database.Database` (`sqlite.ts:61-62`) — the backend passes its own connection straight in (`db.ts:45-48`), so the RAG tables and the app's `conversations`/`documents` tables live in the same `.db` file.

## Code walkthrough

- **`packages/rag/src/types.ts:90-126`** — the full `Store` interface definition, which both implementations follow.
  ```ts
  export interface Store {
    indexModel(tenantId: string): Promise<string | undefined>
    upsertPage(tenantId: string, page: Page, chunks: EmbeddedChunk[]): Promise<void>
    searchVector(tenantId: string, query: Float32Array, limit: number): Promise<Scored[]>
    searchKeyword(tenantId: string, query: string, limit: number): Promise<Scored[]>
  }
  ```

- **`packages/rag/src/store/sqlite.ts:356-368`** — brute-force cosine, a plain O(n) scan:
  ```ts
  const { ids, vectors } = this.index(tenantId)
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < ids.length; i++) {
    scored.push({ id: ids[i]!, score: similarity(query, vectors[i]!) })
  }
  scored.sort((a, b) => b.score - a.score)
  ```

- **`packages/rag/src/store/pgvector.ts:228-236`** — the same work, inside the DB via the `<=>` operator:
  ```ts
  `SELECT id, url, title, headings, question, text, tokens,
          1 - (embedding <=> $2::vector) AS score
   FROM chunks WHERE tenant_id = $1
   ORDER BY embedding <=> $2::vector LIMIT $3`
  ```

- **`packages/rag/src/store/sqlite.ts:91-97`** — the composite key `(tenant_id, id)`: a chunk id is only `url#position`, and two tenants can index the same public docs site — with `id` alone as the primary key, the second ingest would fail on a UNIQUE constraint.

- **`packages/backend/src/db.ts:38-49`** — where the actual decision happens:
  ```ts
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl })
    store = new PgVectorStore(pool)
    await pgStore.migrate()
  } else {
    const sqlite = new Database(process.env.DB_PATH ?? "freddy.db")
    store = new SqliteStore(sqlite)
  }
  ```

- **`packages/rag/src/store/pgvector.ts:9-15`** — the file-header comment: there's no ANN index (HNSW) yet, "worth adding once a tenant's chunk count actually makes a sequential scan show up in latency — not before."

## Diagram

The diagram (`10-storage-layer.excalidraw`) shows `search.ts` and `ingest.ts` talking only to the `Store` interface box sitting between them — arrows run down from both into the `Store` box. Below the Store box is a decision diamond (`DATABASE_URL set? — db.ts`), from which two arrows lead into the two implementation boxes: `SqliteStore` (better-sqlite3, FTS5 keyword search, brute-force cosine JS loop, WAL mode) and `PgVectorStore` (Postgres + pgvector, server-side `<=>` distance). Small captions sit under each — under SqliteStore, "few thousand chunks ≈ 1ms brute force — good enough until it isn't", and under PgVectorStore, "no ANN index yet — sequential scan". To open the file, use File → Open on excalidraw.com, or just drag it onto the canvas.

## Interview questions

**Q: Why build a `Store` interface instead of just using the concrete class directly?**
A: So `ingest.ts`/`search.ts` never know what the underlying DB is. The dev harness runs "clone it and run it" on SQLite, and production switches to Postgres by setting `DATABASE_URL` — without touching pipeline code. Classic dependency inversion.

**Q: Why wasn't `sqlite-vec` used for the dev store?**
A: macOS's system SQLite ships compiled without extension loading, so using sqlite-vec would mean making every developer install SQLite from Homebrew. `better-sqlite3` brings its own bundled binary with FTS5 already in it — the "clone and run" promise stays intact.

**Q: Why isn't brute-force vector search a problem in production (for now)?**
A: A typical docs site is a few thousand chunks, and computing a few thousand dot products (768-dim) takes ~1ms — noise next to the network round trip of the embedding API call. Reaching tens or hundreds of thousands of chunks is the signal to switch to `PgVectorStore`.

**Q: Why is WAL mode explicitly enabled?**
A: In the default journal mode, writes block readers. In WAL, an ingest's write and the dashboard's search read can genuinely run concurrently — it's set in both places (`sqlite.ts`, `db.ts`).

**Q: When does the in-memory index cache get invalidated?**
A: On every write (`upsertPage`, `deletePage`, `clear`, etc.) it's dropped immediately via `this.indexes.delete(tenantId)` and rebuilt lazily on the next search — so stale vectors are never served.

**Q: Why is the chunk table's key `(tenant_id, id)` rather than just `id`?**
A: A chunk id is `url#position` — unique only within a page. If two tenants crawl the same public docs site they get the same ids; with `id` alone as the key, the second tenant would fail on a UNIQUE constraint. `rebuildStaleChunks()` also migrates older DBs onto this fix.

**Q: What would it take to add a third store?**
A: Write a new class implementing `Store`, and add a third branch in `db.ts` that instantiates it under the right condition. Not one line of `ingest.ts`/`search.ts` has to be touched.

**Q: What problem does `EmbeddingModelMismatch` prevent?**
A: Two different models can produce vectors of the same dimension (768) — so a mismatch doesn't crash, it produces confidently-ranked but unrelated results, which then get cited as fact. `indexModel`/`setIndexModel` check before every search, and a typed error is thrown on a mismatch.

## Common confusions

- Treating the SQLite store as "just a dev toy" — brute-force cosine is perfectly correct, it only looks naive; the issue is scale, not correctness.
- Treating `sqlite-vec` and `better-sqlite3` as the same thing — `sqlite-vec` is a loadable vector extension (not in the default store at all), while `better-sqlite3` is an npm package with a bundled SQLite (with FTS5, without the vector extension).
- Treating `PgVectorStore` as "the real scale solution with an ANN index" — there's no HNSW index yet; it also does a sequential scan, just server-side.
- Reading the in-memory `indexes` cache as a per-request cache — it's actually a process-lifetime cache, invalidated only on a write.
