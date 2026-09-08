/**
 * The pipeline, end to end: crawl → extract → chunk → embed → store.
 *
 * Written as an async generator of events rather than a function returning a
 * summary. An ingest takes minutes, and the playground's whole value is
 * watching where it goes wrong — which pages were skipped, how many chunks a
 * page produced, whether the crawler found a sitemap at all. A promise that
 * resolves at the end can only report that it finished.
 *
 * Re-running is the refresh path. Pages whose extracted text hashes to what is
 * already stored are skipped before embedding, so a nightly run over an
 * unchanged site costs the crawl and nothing else.
 */
import { crawl, DEFAULT_CRAWL, type CrawlOptions } from "./crawl"
import { chunkPage } from "./chunk"
import { embedChunks, embeddingModelId } from "./embed"
import { extract } from "./extract"
import type { Store } from "./types"

export type IngestEvent =
  | { kind: "start"; origin: string }
  | { kind: "page"; url: string; title: string; chunks: number; done: number }
  | { kind: "skip"; url: string; reason: string }
  | { kind: "unchanged"; url: string; done: number }
  | {
      kind: "done"
      pages: number
      chunks: number
      skipped: number
      unchanged: number
      removed: number
      tokens: number
      ms: number
    }
  | { kind: "error"; message: string }

export type IngestOptions = {
  tenantId: string
  url: string
  crawl?: Partial<CrawlOptions>
  /** Off by default: a first run on a site should never delete anything, and
   *  a crawl cut short by `maxPages` would otherwise wipe the tail of the
   *  site it never reached. The refresh job turns it on. */
  prune?: boolean
  signal?: AbortSignal
}

export async function* ingest(
  store: Store,
  options: IngestOptions
): AsyncGenerator<IngestEvent> {
  const started = Date.now()
  const crawlOptions: CrawlOptions = { ...DEFAULT_CRAWL, ...options.crawl }
  crawlOptions.signal = options.signal

  let pages = 0
  let chunks = 0
  let skipped = 0
  let unchanged = 0
  let tokens = 0
  const seen: string[] = []

  try {
    /*
     * Refuse to extend an index with vectors from a different model.
     *
     * Mixing them is not a crash — both backends emit 768 floats — so half the
     * namespace would silently stop being retrievable while search kept
     * returning confident results from the other half. Caught here rather than
     * at the first `upsertPage` so nothing is crawled or embedded first.
     */
    const model = embeddingModelId()
    const stored = await store.indexModel(options.tenantId)
    if (stored && stored !== model) {
      yield {
        kind: "error",
        message: `this knowledge base was built with ${stored}, but ${model} is configured now — clear it before ingesting`,
      }
      return
    }
    await store.setIndexModel(options.tenantId, model)

    yield { kind: "start", origin: new URL(options.url).origin }

    for await (const fetched of crawl(options.url, crawlOptions)) {
      if (options.signal?.aborted) break
      seen.push(fetched.url)

      const extracted = await extract(fetched.url, fetched.html)
      if (!extracted.ok) {
        skipped++
        yield { kind: "skip", url: extracted.url, reason: extracted.reason }
        continue
      }

      const { page, faqs } = extracted

      // The cheap exit. Compare before chunking, not after: chunking is free
      // but embedding is not, and a hash match means neither is needed.
      if ((await store.pageHash(options.tenantId, page.url)) === page.hash) {
        unchanged++
        yield { kind: "unchanged", url: page.url, done: pages + unchanged }
        continue
      }

      const pageChunks = chunkPage(page, faqs)
      if (!pageChunks.length) {
        skipped++
        yield { kind: "skip", url: page.url, reason: "no-chunks" }
        continue
      }

      const embedded = await embedChunks(pageChunks, undefined, options.signal)
      tokens += embedded.tokens
      await store.upsertPage(options.tenantId, page, embedded.chunks)

      pages++
      chunks += embedded.chunks.length
      yield {
        kind: "page",
        url: page.url,
        title: page.title,
        chunks: embedded.chunks.length,
        done: pages + unchanged,
      }
    }

    const removed = options.prune
      ? await store.removePagesNotIn(options.tenantId, seen)
      : 0

    yield {
      kind: "done",
      pages,
      chunks,
      skipped,
      unchanged,
      removed,
      tokens,
      ms: Date.now() - started,
    }
  } catch (cause) {
    yield {
      kind: "error",
      message: cause instanceof Error ? cause.message : "ingest failed",
    }
  }
}
