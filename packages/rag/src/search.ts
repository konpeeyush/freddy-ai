/**
 * Hybrid retrieval: vectors and keywords, fused.
 *
 * Vector search alone loses on the queries support bots get most — exact
 * product names, error codes, API parameters, plan tiers. An embedding of
 * "SSO_REDIRECT_MISMATCH" is close to every other error string on the site,
 * while BM25 finds it instantly. Keyword search alone loses on the other half:
 * "can I get my money back" shares no words with a page titled "Refunds".
 *
 * They are combined with Reciprocal Rank Fusion rather than a weighted sum of
 * scores, because the two scores are not comparable — cosine sits in [-1, 1]
 * and BM25 is unbounded and corpus-dependent, so any weighting that works on
 * one site is wrong on the next. RRF only reads the *rank*, which is exactly
 * the property that transfers.
 */
import { embeddingModelId, embedQuery } from "./embed"
import { EmbeddingModelMismatch, type Hit, type Scored, type Store } from "./types"

export type SearchOptions = {
  /** Candidates pulled from each retriever before fusion. */
  candidates: number
  /** How many survive. Five fits a support answer without crowding out the
   *  conversation; more mostly adds tokens and distraction. */
  limit: number
  /**
   * Cosine floor for the vector side.
   *
   * The point of this is not ranking, it is being able to say "I don't know".
   * Without a floor the top result for a question the docs never answer is
   * still *something*, and a model handed something will use it — which is the
   * mechanism behind most confident RAG hallucinations.
   */
  minSimilarity: number
  signal?: AbortSignal
}

export const DEFAULT_SEARCH: SearchOptions = {
  candidates: 20,
  limit: 5,
  minSimilarity: 0.35,
}

/** Dampens the head of the ranking. 60 is the value from the original paper
 *  and behaves well without tuning per corpus. */
const RRF_K = 60

function fuse(
  vector: Scored[],
  keyword: Scored[],
  limit: number
): Hit[] {
  const fused = new Map<string, Hit>()

  const add = (list: Scored[], via: "vector" | "keyword") => {
    list.forEach((entry, rank) => {
      const existing = fused.get(entry.chunk.id)
      const contribution = 1 / (RRF_K + rank + 1)
      if (existing) {
        existing.score += contribution
        existing.via.push(via)
      } else {
        fused.set(entry.chunk.id, {
          ...entry.chunk,
          score: contribution,
          via: [via],
        })
      }
    })
  }

  add(vector, "vector")
  add(keyword, "keyword")

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export async function search(
  store: Store,
  tenantId: string,
  query: string,
  options: Partial<SearchOptions> = {}
): Promise<Hit[]> {
  const opts = { ...DEFAULT_SEARCH, ...options }

  /*
   * Checked before the query is embedded, not after.
   *
   * Both supported backends emit 768 floats, so a query vector from one model
   * measured against chunks from another ranks perfectly happily — and returns
   * unrelated passages that the model then cites as fact. Failing loudly is
   * the only safe behaviour, and doing it first saves a pointless round trip.
   */
  const stored = store.indexModel(tenantId)
  const current = embeddingModelId()
  if (stored && stored !== current) {
    throw new EmbeddingModelMismatch(stored, current)
  }

  const embedding = await embedQuery(query, opts.signal)

  const vector = store
    .searchVector(tenantId, embedding, opts.candidates)
    .filter((entry) => entry.score >= opts.minSimilarity)
  const keyword = store.searchKeyword(tenantId, query, opts.candidates)

  return fuse(vector, keyword, opts.limit)
}
