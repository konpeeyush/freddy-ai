# Storage Layer — SQLite vs pgvector
_Ek hi `Store` interface ke peeche, do alag databases chhupe hain — dev mein SQLite, scale pe Postgres._

## Yeh hai kya? (What is this)

RAG pipeline (crawl → extract → chunk → embed → **store**) ko chunks aur unke embeddings (vector — text ka numeric representation) kahin save karne hain, aur baad mein search karne hain. `packages/rag/src/types.ts` mein ek `Store` interface hai jo bas contract define karta hai — implementation nahi. Do classes usse implement karti hain: `SqliteStore` (dev/default, better-sqlite3 pe) aur `PgVectorStore` (production scale, Postgres + pgvector pe).

## Yeh kyun banaya gaya? (Why it exists)

Pipeline ka baaki hissa — `ingest.ts` aur `search.ts` — kabhi seedha SQLite ya Postgres se baat nahi karta, sirf `Store` interface se karta hai (dono `store: Store` type lete hain — `search.ts:80`, `ingest.ts:49`). `types.ts:1-9` khud yeh likh deta hai:

> `Store` exists so the dev harness can run on SQLite with nothing installed while the same search code later runs on pgvector. Everything above it — crawl, extract, chunk, embed, search — is written against this interface and has never heard of either.

Matlab: DB swap karna ho toh ek nayi class likhni hogi, `search.ts` ya `ingest.ts` ki ek line bhi nahi badalni padegi.

Doosra decision: dev store ke liye `sqlite-vec` (SQLite ka loadable vector extension) use nahi kiya. `sqlite.ts:5-11` ka comment seedha bataata hai kyun:

> macOS ships a system SQLite compiled without extension support — so using it means telling every developer to install SQLite from Homebrew and wire up extension loading before the app will start. For a harness whose whole promise is "clone it and run it", that trade is wrong.

Isliye `better-sqlite3` — apna bundled SQLite binary laata hai, jisme FTS5 (keyword search) already compiled hai. Hybrid search (vector + keyword) isliye "free" mil jaata hai.

## Kaise kaam karta hai (How it works, step by step)

1. **Startup pe decision.** `db.ts:33-49` check karta hai `DATABASE_URL` set hai ya nahi. Nahi — `new SqliteStore(sqlite)`. Haan — `new PgVectorStore(pool)` + `await pgStore.migrate()`. Dono cases mein `store` variable sirf `Store` type ka hota hai.

2. **Ingest (`upsertPage`).** Page crawl+chunk+embed hone ke baad `store.upsertPage()` call hota hai — purane chunks delete, naye insert, ek transaction ke andar (SQLite: `db.transaction()`, `sqlite.ts:211`; Postgres: `BEGIN`/`COMMIT`, `pgvector.ts:158`).

3. **Embedding storage.** SQLite mein `Float32Array` ka buffer seedha raw `BLOB` ban jaata hai (`sqlite.ts:239-243`). Postgres mein yeh real `vector(768)` typed column hai, text literal `[0.1,0.2,...]` format mein (`toVectorLiteral`, `pgvector.ts:49-51`).

4. **Vector search — sabse bada farak.** `SqliteStore.searchVector` (`sqlite.ts:356-382`) saare tenant vectors memory mein load karke JS loop mein cosine `similarity()` compute karta hai — brute force, koi index nahi. `PgVectorStore.searchVector` (`pgvector.ts:222-241`) yehi kaam Postgres ke andar `ORDER BY embedding <=> $2::vector` se karwata hai — server-side, par woh bhi abhi sequential scan hi hai, ANN index (HNSW) nahi hai.

5. **Keyword search dono jagah.** SQLite mein FTS5 + `bm25()` (`sqlite.ts:384-424`); Postgres mein generated `tsvector` + GIN index + `ts_rank` (`pgvector.ts:243-289`). Dono jagah query ko words mein split karke `OR` se jodte hain, taaki special characters syntax na todein aur ek term match hone pe bhi result mile.

6. **In-memory cache (SQLite-only).** Har query pe BLOB deserialize karna slow step hota — isliye `Map<tenantId, Index>` cache lazily banta hai (`sqlite.ts:334-354`) aur kisi bhi write pe drop ho jaata hai (`this.indexes.delete(tenantId)`).

7. **WAL mode dono jagah on hai** (`sqlite.ts:65`, `db.ts:46`) — taaki ingest ka write, search ke read ko block na kare; dono concurrently chal sakte hain.

8. **Ek hi file, do purpose.** `SqliteStore`'s constructor already-open `Database.Database` bhi le sakta hai (`sqlite.ts:61-62`) — backend apna connection seedha pass karta hai (`db.ts:45-48`), toh RAG tables aur app ki `conversations`/`documents` tables ek hi `.db` file mein rehti hain.

## Code walkthrough

- **`packages/rag/src/types.ts:90-126`** — `Store` interface ki poori definition, jise dono implementations follow karti hain.
  ```ts
  export interface Store {
    indexModel(tenantId: string): Promise<string | undefined>
    upsertPage(tenantId: string, page: Page, chunks: EmbeddedChunk[]): Promise<void>
    searchVector(tenantId: string, query: Float32Array, limit: number): Promise<Scored[]>
    searchKeyword(tenantId: string, query: string, limit: number): Promise<Scored[]>
  }
  ```

- **`packages/rag/src/store/sqlite.ts:356-368`** — brute-force cosine, seedha O(n) scan:
  ```ts
  const { ids, vectors } = this.index(tenantId)
  const scored: { id: string; score: number }[] = []
  for (let i = 0; i < ids.length; i++) {
    scored.push({ id: ids[i]!, score: similarity(query, vectors[i]!) })
  }
  scored.sort((a, b) => b.score - a.score)
  ```

- **`packages/rag/src/store/pgvector.ts:228-236`** — wahi kaam, DB ke andar `<=>` operator se:
  ```ts
  `SELECT id, url, title, headings, question, text, tokens,
          1 - (embedding <=> $2::vector) AS score
   FROM chunks WHERE tenant_id = $1
   ORDER BY embedding <=> $2::vector LIMIT $3`
  ```

- **`packages/rag/src/store/sqlite.ts:91-97`** — composite key `(tenant_id, id)`: chunk id sirf `url#position` hota hai, do tenants same public docs site index kar sakte hain — `id` akela primary key hota toh doosra ingest UNIQUE-constraint pe fail hota.

- **`packages/backend/src/db.ts:38-49`** — actual decision kahan hota hai:
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

- **`packages/rag/src/store/pgvector.ts:9-15`** — file-header comment: abhi koi ANN index (HNSW) nahi, "worth adding once a tenant's chunk count actually makes a sequential scan show up in latency — not before."

## Diagram

Neel diagram (`10-storage-layer.excalidraw`) mein dikhaya gaya hai ki `search.ts` aur `ingest.ts` sirf beech mein baithe `Store` interface box se baat karte hain — dono se arrows upar se `Store` box mein jaate hain. Store box se neeche ek decision diamond hai (`DATABASE_URL set? — db.ts`), jahan se do arrows nikal ke do implementation boxes mein jaate hain: `SqliteStore` (better-sqlite3, FTS5 keyword search, brute-force cosine JS loop, WAL mode) aur `PgVectorStore` (Postgres + pgvector, server-side `<=>` distance). Dono boxes ke neeche chhote captions hain — SqliteStore ke neeche "few thousand chunks ≈ 1ms brute force — good enough until it isn't", PgVectorStore ke neeche "no ANN index yet — sequential scan". File kholne ke liye excalidraw.com par File → Open, ya seedha canvas pe drag-drop kar dijiye.

## Interview questions

**Q: `Store` interface kyun banaya, seedha concrete class kyun nahi use kar liya?**
A: Taaki `ingest.ts`/`search.ts` kabhi na jaane underlying DB kya hai. Dev harness SQLite pe "clone karo aur chalao" chalta hai, production `DATABASE_URL` set karke Postgres pe switch ho jaata hai — bina pipeline code touch kiye. Classic dependency inversion.

**Q: `sqlite-vec` kyun nahi use kiya dev store mein?**
A: macOS ka system SQLite extension-loading ke bina compiled aata hai, toh sqlite-vec use karne ka matlab har developer ko Homebrew se SQLite install karwana. `better-sqlite3` apna bundled binary laata hai jisme FTS5 already hai — "clone and run" promise nahi tootata.

**Q: Brute-force vector search production mein problem kyun nahi hai (abhi)?**
A: Typical docs site kuch hazaar chunks ka hota hai, aur kuch hazaar dot products (768-dim) compute karna ~1ms leta hai — embedding API call ke network round trip ke saamne noise hai. Tens/hundreds of thousands chunks tak pahunchne pe `PgVectorStore` pe switch karne ka signal milta hai.

**Q: WAL mode kyun explicit enable kiya?**
A: Default journal mode mein writes readers ko block karte hain. WAL mein ingest ka write aur dashboard ka search read genuinely concurrently chal sakte hain — dono jagah (`sqlite.ts`, `db.ts`) set kiya gaya hai.

**Q: In-memory index cache kab invalidate hota hai?**
A: Har write (`upsertPage`, `deletePage`, `clear`, etc.) pe `this.indexes.delete(tenantId)` se turant drop hota hai, aur agli search pe lazily rebuild hota hai — taaki stale vectors serve na hon.

**Q: Chunk table ki key `(tenant_id, id)` kyun, `id` akela kyun nahi?**
A: Chunk id `url#position` hai — sirf ek page ke andar unique. Do tenants same public docs site crawl karein toh same id milega; `id` akela key hota toh doosra tenant UNIQUE-constraint pe fail hota. `rebuildStaleChunks()` purane DBs ko is fix pe migrate bhi karta hai.

**Q: Ek third store add karna ho toh kya karna padega?**
A: `Store` implement karti nayi class likhni padegi, aur `db.ts` mein ek teesra branch add karna padega jo sahi condition pe usse instantiate kare. `ingest.ts`/`search.ts` ki ek line touch nahi karni padegi.

**Q: `EmbeddingModelMismatch` kis problem ko rokta hai?**
A: Do alag models same dimension (768) ke vectors bana sakte hain — mismatch pe crash nahi hota, balki confidently-ranked par unrelated results milte hain jo phir fact ki tarah cite ho jaate hain. `indexModel`/`setIndexModel` har search se pehle check karte hain, mismatch pe typed error throw hota hai.

## Common confusions (log yahan confuse hote hain)

- SQLite store ko "sirf dev ke liye toy" samajhna — brute-force cosine perfectly correct hai, sirf naive lagta hai; issue scale ka hai, correctness ka nahi.
- `sqlite-vec` aur `better-sqlite3` ko same samajhna — `sqlite-vec` loadable vector extension hai (default store mein hai hi nahi), `better-sqlite3` bundled-SQLite npm package hai (FTS5 ke saath, vector extension ke bina).
- `PgVectorStore` ko "ANN index wala asli scale solution" samajhna — abhi koi HNSW index nahi hai, woh bhi sequential scan hi karta hai, bas server-side.
- In-memory `indexes` cache ko per-request cache samajhna — asal mein yeh process-lifetime cache hai, sirf write pe invalidate hota hai.
