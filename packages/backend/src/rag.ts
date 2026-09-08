/**
 * The knowledge base: ingestion, search, and the store behind both.
 *
 * Retrieval is stateful by necessity — ingestion holds the embedding key and
 * takes minutes, neither of which a customer's page can do. SQLite rather
 * than a vector database: see `@workspace/rag`'s store for the reasoning —
 * briefly, brute-force cosine over a docs site is about a millisecond, and
 * `Store` is the interface to swap when it is not.
 */
import { ingest, search, type IngestEvent } from "@workspace/rag"
import type { RagHit, RagSource } from "@workspace/api/schema"

import { store as ragStore } from "./db"

export { ragStore }

/*
 * In-flight ingests, keyed by tenant.
 *
 * One at a time per knowledge base: two crawls of the same site would race on
 * the same rows and double the embedding bill for one result. Starting a
 * second cancels the first rather than erroring — hitting ingest again almost
 * always means "I changed the URL", not "run both".
 */
const running = new Map<string, AbortController>()

/** Omitted `tenantId` asks the same question `ragSources` does when it omits
 *  one: not "is the default tenant ingesting" but "is anything". */
export function ingestRunning(tenantId?: string): boolean {
  return tenantId ? running.has(tenantId) : running.size > 0
}

export function cancelIngest(tenantId: string): boolean {
  const controller = running.get(tenantId)
  controller?.abort()
  return Boolean(controller)
}

/**
 * Runs an ingest, streaming its progress as server-sent events.
 *
 * SSE rather than a JSON response because an ingest takes minutes and the
 * useful part is watching which pages were skipped and why. A promise that
 * resolves at the end can only report that it finished.
 */
export function ingestStream(options: {
  tenantId: string
  url: string
  maxPages: number
  prune: boolean
  /** The client hanging up should stop the crawl, not orphan it. */
  clientSignal?: AbortSignal
}): Response {
  const { tenantId } = options

  // Supersede rather than reject. See the note on `running` above.
  running.get(tenantId)?.abort()
  const controller = new AbortController()
  running.set(tenantId, controller)
  options.clientSignal?.addEventListener("abort", () => controller.abort())

  const encoder = new TextEncoder()
  // Set by `cancel()`, which the platform calls when the client disconnects.
  // `enqueue`/`close` throw on a controller already closed that way, and
  // `start`'s loop has no way to know that happened short of checking this.
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(target) {
      const send = (event: IngestEvent) => {
        if (closed) return
        target.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      try {
        for await (const event of ingest(ragStore, {
          tenantId,
          url: options.url,
          prune: options.prune,
          crawl: { maxPages: options.maxPages },
          signal: controller.signal,
        })) {
          send(event)
        }
      } catch (cause) {
        console.error("ingest failed:", cause)
        send({
          kind: "error",
          message: cause instanceof Error ? cause.message : "ingest failed",
        })
      } finally {
        // Only clear if this run is still the current one — a superseding
        // ingest has already replaced the entry and must not be evicted.
        if (running.get(tenantId) === controller) running.delete(tenantId)
        if (!closed) {
          closed = true
          target.close()
        }
      }
    },
    cancel() {
      closed = true
      controller.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      // Proxies that buffer would hold every event until the ingest ended,
      // which defeats the reason this is a stream at all.
      "x-accel-buffering": "no",
    },
  })
}

/** Hybrid search, in the shape the wire contract declares. */
export async function ragSearch(
  tenantId: string,
  query: string,
  limit: number
): Promise<RagHit[]> {
  const hits = await search(ragStore, tenantId, query, { limit })
  return hits.map((hit) => ({
    id: hit.id,
    url: hit.url,
    title: hit.title,
    headings: hit.headings,
    question: hit.question,
    text: hit.text,
    tokens: hit.tokens,
    score: hit.score,
    via: hit.via,
  }))
}

export function ragSources(tenantId?: string): RagSource[] {
  return ragStore.stats(tenantId)
}
