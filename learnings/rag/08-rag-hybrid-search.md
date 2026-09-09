# RAG Hybrid Search — vector + keyword search, mixed together
_Two friends who think in completely different ways give a better answer together — vector and keyword search, both._

## What is this?

Whenever a user asks something through the widget, the backend first has to find the relevant doc chunks that will help build the answer — this is called "retrieval" (the "R" in RAG). The `search()` function in `packages/rag/src/search.ts` does that job, but not in one way — it runs two different retrieval methods (vector similarity and keyword/BM25) and mixes their results with a smart algorithm (Reciprocal Rank Fusion) to produce the top 5 chunks. It's called "hybrid search" because the strengths of both approaches get combined.

## Why it exists

Using vector search (meaning-based) alone has one big weakness — it fails on exact strings. The comment at the top of the file spells it out:

```ts
// packages/rag/src/search.ts:4-8
 * Vector search alone loses on the queries support bots get most — exact
 * product names, error codes, API parameters, plan tiers. An embedding of
 * "SSO_REDIRECT_MISMATCH" is close to every other error string on the site,
 * while BM25 finds it instantly. Keyword search alone loses on the other half:
 * "can I get my money back" shares no words with a page titled "Refunds".
```

So each approach fails in its own way: with vector search alone, a random-ish token like an error code looks "numerically close" to every other error string — meaning-wise it carries no real signal. With keyword search alone, a natural question like "can I get my money back" matches literally zero words on the "Refunds" page. So run both and combine whatever each finds.

## How it works, step by step

1. **The embedding-model mismatch check comes first** — before the query is even embedded, it checks that the model the index was built with is still the configured one (`search.ts:95-99`). On a mismatch it throws `EmbeddingModelMismatch` immediately — not even the embedding network call is wasted.
2. **The query is embedded** — `embedQuery(query)` turns it into a 768-number vector (`embed.ts`, detailed in the next section).
3. **Vector search runs** — `store.searchVector(tenantId, embedding, candidates)` finds the top 20 candidates by cosine similarity (`candidates: 20` by default).
4. **The similarity floor is applied** — any result scoring below `minSimilarity` (0.35) is discarded (`search.ts:108-110`) — the reason is in the next section.
5. **Keyword search runs in parallel** — `store.searchKeyword` pulls the BM25 algorithm's top 20 matches through SQLite FTS5 (the full-text search extension).
6. **The two lists are fused with RRF** — `fuse(vector, keyword, limit)` looks only at each result's RANK POSITION in each list and scores it with the formula `1 / (60 + rank)`. If a chunk appears in both lists, both contributions add up.
7. **The top 5 are returned**, sorted by fused score, each tagged with `via: ["vector"]` / `["keyword"]` / `["vector","keyword"]` — telling you which retriever found it.

## Code walkthrough

- **`packages/rag/src/search.ts:37-41`** — the defaults: `candidates: 20` (how many to pull from each retriever before fusion), `limit: 5` (final results), `minSimilarity: 0.35` (the vector floor).
```ts
export const DEFAULT_SEARCH: SearchOptions = {
  candidates: 20,
  limit: 5,
  minSimilarity: 0.35,
}
```

- **`packages/rag/src/search.ts:47-77`** — the `fuse()` function, the actual RRF implementation. It iterates each list adding `contribution = 1 / (RRF_K + rank + 1)`; if the chunk is already in the map, the second retriever is pushed into its `via` array:
```ts
const contribution = 1 / (RRF_K + rank + 1)
if (existing) {
  existing.score += contribution
  existing.via.push(via)
} else {
  fused.set(entry.chunk.id, { ...entry.chunk, score: contribution, via: [via] })
}
```

- **`packages/rag/src/search.ts:95-99`** — the model mismatch check, before embedding. The comment gives the reasoning itself: both backends output 768-float vectors, so a mismatch wouldn't crash — it would produce a "confidently ranked list of unrelated passages", the worst failure mode, because no error ever surfaces.

- **`packages/rag/src/store/sqlite.ts:389-398`** — keyword search splits the raw query into terms, quotes them, and joins with OR to avoid FTS5's own query syntax (an apostrophe or `*` is an operator in FTS5 and can cause a syntax error):
```ts
const terms = query
  .toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter((t) => t.length > 2)
  .slice(0, 12)
  .map((t) => `"${t}"`)
```

- **`packages/rag/src/embed.ts:47-79`** — the `backend()` function decides whether to use Google or Ollama (via `resolveProvider()`, which the chat model also uses), and gives a different `taskType`/prefix depending on the `target` ("document" or "query") — which is exactly why document and query embeddings aren't symmetric, on purpose.

## Diagram

The diagram (`08-rag-hybrid-search.excalidraw`) shows a "User query" splitting into two parallel paths: on one side "Embed query" → "Vector search (cosine, floor 0.35)", on the other side directly "FTS5 keyword search (BM25)" — both working over the same candidate pool. Each produces its own "Ranked list", and the two meet in an "RRF Fuse (rank-based, k=60)" box, out of which comes the final "Top 5 results" box, with a caption underneath — "each result tagged: via vector / keyword / both". Open it on excalidraw.com via File → Open, or drag the file onto the canvas.

## Interview questions

**Q: Why can't you use vector search alone?**
A: It's weak on exact strings — the embedding of a token like an error code or product name doesn't differentiate meaningfully, and one error code lands numerically close to every other error string. The comment at the top of `search.ts` uses exactly this example with `SSO_REDIRECT_MISMATCH` — BM25 finds it instantly by exact match while vector search gets confused.

**Q: Why can't you use keyword search alone?**
A: Users ask in their own words, not the docs' exact words — no word in "can I get my money back" matches the "Refunds" page, so keyword-only returns zero results. Vector search captures meaning and handles that case.

**Q: What is RRF (Reciprocal Rank Fusion), and why not a weighted average?**
A: RRF looks only at each result's rank position, not its actual score — the formula is `1 / (60 + rank)`. A weighted average isn't usable because cosine similarity is in the [-1, 1] range while BM25 is unbounded and corpus-dependent — the numbers aren't directly comparable. A weighting that works well for one site can be wrong for another; rank position is the one property that transfers consistently across corpora (`search.ts:10-14`). RRF_K=60 is the value from the original paper and works well without per-corpus tuning (`search.ts:43-45`).

**Q: Why is the `minSimilarity: 0.35` floor there — is its purpose to improve ranking?**
A: No, its purpose isn't ranking, it's making "I don't know" possible. Vector search always finds some "closest" chunk whether or not the docs cover the topic — without a floor, the model is handed something and confidently builds an answer out of it, which is the most common mechanism behind hallucination (`search.ts:26-31`). The floor discards anything less than 0.35 similar so that "no good match" becomes a genuinely reachable outcome.

**Q: Why does the embedding-model mismatch check happen BEFORE embedding the query?**
A: Two reasons — fail fast (if we know there's a mismatch, the embedding round-trip is wasted), and safety: both backends output 768-dimension vectors, so without the check a mismatch silently produces a "confidently ranked list of unrelated passages" — no crash, no empty result, just a wrong answer the model cites as fact (`search.ts:87-99`, `embed.ts:82-90`).

**Q: What could go wrong if you changed `candidates: 20` to `candidates: 5`?**
A: The fusion pool gets smaller — a chunk that ranks 8th in vector search (outside the top 5) but 2nd in keyword search would never be in the vector list at all with candidates=5, and could only contribute from keyword. The chance of getting a "second opinion" from both retrievers drops, especially for borderline-relevant chunks.

**Q: What is the `via` field (the vector/keyword/both tag) practically good for?**
A: Debugging — a result that's only `via: ["keyword"]` means the embedding model didn't really understand the query, while `via: ["vector"]` tells you the wording was unusual but no keyword matched. The comment in `types.ts` says it: "fastest way to tell 'the embedding is wrong' from 'the wording is unusual'" — it's a diagnostic signal, not just metadata.

## Common confusions

- Thinking the minSimilarity floor is there for "better results" is wrong — its purpose is to make "no results" a valid, reachable outcome.
- Thinking RRF scores can be compared directly against cosine similarity or BM25 scores is wrong — a fused score is only comparable within its own result set (see the `Hit.score` comment in `types.ts`).
- Assuming document and query embeddings are symmetric is a common mistake — different taskTypes/prefixes are used deliberately (`embed.ts:23-24, 57-65`); treat them as the same by accident and you get no error, just silently worse recall.
- Treating FTS5 as "simple string matching" is wrong — it has its own query syntax where apostrophes/`*`/`(` are operators, so the raw query can't be sent through directly; the terms have to be split, quoted, and OR'd (`sqlite.ts:389-398`).
