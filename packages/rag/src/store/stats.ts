/**
 * The origin-grouping behind `Store.stats()`, shared by every backend.
 *
 * Kept out of each store's SQL on purpose: extracting a URL's origin reads
 * very differently in SQLite (no native regex) and Postgres (easy with
 * `regexp_replace`), and duplicating that divergence would make the two
 * stores disagree about what counts as one "source" for reasons that have
 * nothing to do with the storage engine. Both stores instead run the same
 * cheap query — per-page url/fetchedAt/chunk-count, already scoped by
 * tenant — and hand the rows here.
 */
import type { SourceStats } from "../types"

export type PageStatRow = {
  tenantId: string
  url: string
  fetchedAt: number
  chunks: number
}

/**
 * One bucket per (tenant, origin) — a crawled site's page/chunk counts.
 *
 * Uploaded documents' synthetic `upload://tenant/id` URLs are excluded:
 * `new URL(...).origin` on a non-special scheme like that resolves to the
 * literal string `"null"` per the WHATWG URL spec rather than throwing, so
 * they'd otherwise silently collect into one bogus "null" source. Uploads
 * already have their own home in `/documents` — this represents crawled
 * sites only.
 */
export function groupPagesByOrigin(
  rows: PageStatRow[]
): Omit<SourceStats, "embeddingModel">[] {
  type Bucket = Omit<SourceStats, "embeddingModel">
  const buckets = new Map<string, Bucket>()

  for (const r of rows) {
    let origin: string
    try {
      origin = new URL(r.url).origin
    } catch {
      continue
    }
    if (!origin || origin === "null") continue

    const key = `${r.tenantId} ${origin}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.pages += 1
      bucket.chunks += r.chunks
      bucket.lastIngestedAt = Math.max(bucket.lastIngestedAt, r.fetchedAt)
    } else {
      buckets.set(key, {
        tenantId: r.tenantId,
        origin,
        pages: 1,
        chunks: r.chunks,
        lastIngestedAt: r.fetchedAt,
      })
    }
  }

  return [...buckets.values()]
}
