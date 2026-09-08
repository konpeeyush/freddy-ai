/**
 * The shapes the ingest pipeline passes between its stages, and the storage
 * contract behind them.
 *
 * `Store` exists so the dev harness can run on SQLite with nothing installed
 * while the same search code later runs on pgvector. Everything above it —
 * crawl, extract, chunk, embed, search — is written against this interface and
 * has never heard of either.
 */

/** A page as fetched, before it is split. */
export type Page = {
  url: string
  title: string
  /** Cleaned markdown: nav, footers and cookie banners already removed. */
  markdown: string
  /**
   * Hash of `markdown`, not of the raw HTML.
   *
   * A docs site rebuilt with a new asset hash changes its HTML on every deploy
   * while the prose is identical. Hashing the extracted text is what makes a
   * re-crawl cheap — otherwise every nightly run re-embeds the whole site.
   */
  hash: string
  fetchedAt: number
}

/** A page split into something small enough to retrieve. */
export type Chunk = {
  id: string
  url: string
  title: string
  /**
   * Where the chunk sits in the page's heading tree, as
   * `["Billing", "Refunds"]`. Prepended to the text before embedding — a chunk
   * that reads "You have 30 days from delivery" is meaningless on its own and
   * matches almost nothing; the same text under "Billing > Refunds" matches
   * the question people actually ask.
   */
  headings: string[]
  text: string
  /** Set when the chunk came from a question/answer pair rather than prose. */
  question?: string
  tokens: number
}

/** A chunk with its vector, ready to store. */
export type EmbeddedChunk = Chunk & { embedding: Float32Array }

/** What search hands back. */
export type Hit = Chunk & {
  /** Fused rank score. Comparable within one result set, not across queries. */
  score: number
  /** Which retriever(s) found it — shown in the playground, and the fastest
   *  way to tell "the embedding is wrong" from "the wording is unusual". */
  via: ("vector" | "keyword")[]
}

/** Per-source bookkeeping, so the playground can say what it knows about. */
export type SourceStats = {
  tenantId: string
  origin: string
  pages: number
  chunks: number
  lastIngestedAt: number
  /** Which embedding model built these vectors. See `Store.indexModel`. */
  embeddingModel?: string
}

/**
 * Raised when an index is read or extended with a different embedding model
 * than the one that built it.
 *
 * Typed rather than a string match because the caller has to distinguish it:
 * this is not retryable and not a bad query, it is a configuration change that
 * needs the index rebuilt.
 */
export class EmbeddingModelMismatch extends Error {
  constructor(
    readonly stored: string,
    readonly current: string
  ) {
    super(
      `this knowledge base was built with ${stored}, but ${current} is configured now — clear it and ingest again`
    )
    this.name = "EmbeddingModelMismatch"
  }
}

export interface Store {
  /**
   * Which embedding model built this index, if it has been built.
   *
   * Checked before every read and every write. Two models can emit vectors of
   * the same width — 768 is a common one — so querying an index built by a
   * different model produces neither a crash nor an empty result. It produces
   * a confidently ranked list of unrelated passages, which then gets cited as
   * fact. That is worth a guard.
   */
  indexModel(tenantId: string): Promise<string | undefined>
  setIndexModel(tenantId: string, model: string): Promise<void>
  /** Replaces every chunk for a URL. Ingest is idempotent because of this. */
  upsertPage(tenantId: string, page: Page, chunks: EmbeddedChunk[]): Promise<void>
  /** The stored hash for a URL, or undefined if it was never ingested. */
  pageHash(tenantId: string, url: string): Promise<string | undefined>
  /** Removes a single URL's page and chunks. Used both by `removePagesNotIn`
   *  and directly by the document-delete endpoint for a single upload. */
  deletePage(tenantId: string, url: string): Promise<void>
  /** Removes every page (and its chunks) whose URL starts with `origin` —
   *  a whole crawled site, in one call. */
  deletePagesByOrigin(tenantId: string, origin: string): Promise<number>
  /** Drops pages that vanished from the sitemap — otherwise a deleted doc
   *  keeps answering questions forever. */
  removePagesNotIn(tenantId: string, urls: string[]): Promise<number>
  /** Vector candidates by cosine similarity. */
  searchVector(
    tenantId: string,
    query: Float32Array,
    limit: number
  ): Promise<Scored[]>
  /** Keyword candidates by BM25. */
  searchKeyword(tenantId: string, query: string, limit: number): Promise<Scored[]>
  stats(tenantId?: string): Promise<SourceStats[]>
  clear(tenantId: string): Promise<void>
  close(): Promise<void>
}

/** A candidate from one retriever, before fusion. */
export type Scored = { chunk: Chunk; score: number }
