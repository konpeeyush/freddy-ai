/**
 * Store and hybrid-retrieval behaviour.
 *
 * Written for one case above all: a query in one namespace must never return
 * another's chunks. Every read filters by `tenant_id`, and a filter dropped in
 * a later refactor would not fail loudly — it would quietly answer a visitor
 * on one customer's site using a different customer's documentation. That is
 * the kind of bug worth a test even in a repo that does not otherwise have
 * many.
 *
 * Embeddings are synthetic, so this runs offline and deterministically. What
 * is under test here is storage, BM25, ranking and scoping — not the
 * embedding model, which has its own failure modes and needs the network.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { normalize } from "../embed"
import { SqliteStore } from "./sqlite"
import type { EmbeddedChunk, Page } from "../types"

const DIM = 16

/** Hashes words into buckets: similar text lands on similar vectors. */
function fakeEmbedding(text: string): Float32Array {
  const values = new Array<number>(DIM).fill(0)
  for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0
    for (const char of word) h = (h * 31 + char.charCodeAt(0)) >>> 0
    values[h % DIM] += 1
  }
  return normalize(values)
}

const path = join(tmpdir(), `rag-store-${process.pid}-${Date.now()}.db`)
const store = new SqliteStore(path)

afterAll(async () => {
  await store.close()
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      unlinkSync(path + suffix)
    } catch {
      // WAL files may not exist. Nothing to clean up is not a failure.
    }
  }
})

function page(url: string, title: string): Page {
  return { url, title, markdown: "", hash: `hash-${url}`, fetchedAt: Date.now() }
}

function chunk(
  from: Page,
  headings: string[],
  text: string
): EmbeddedChunk {
  return {
    id: `${from.url}#${headings.join("/")}`,
    url: from.url,
    title: from.title,
    headings,
    text,
    tokens: Math.ceil(text.length / 4),
    embedding: fakeEmbedding([from.title, ...headings, text].join(" ")),
  }
}

const billing = page("https://acme.test/docs/billing", "Billing")
const errors = page("https://acme.test/docs/errors", "Errors")
const rival = page("https://rival.test/help/refunds", "Refunds")

beforeAll(async () => {
  await store.upsertPage("acme", billing, [
    chunk(billing, ["Refunds"], "You have 30 days from delivery to ask for a refund."),
    chunk(billing, ["Invoices"], "Issued on the first of each month."),
  ])
  await store.upsertPage("acme", errors, [
    chunk(errors, ["SSO"], "SSO_REDIRECT_MISMATCH means the callback url does not match."),
  ])
  await store.upsertPage("rival", rival, [
    chunk(rival, [], "Refunds are never issued under any circumstances."),
  ])
})

describe("tenant scoping", () => {
  test("keyword search never crosses a namespace", async () => {
    const hits = await store.searchKeyword("acme", "refunds", 50)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.chunk.url.startsWith("https://acme.test"))).toBe(true)
  })

  test("vector search never crosses a namespace", async () => {
    const hits = await store.searchVector("acme", fakeEmbedding("refunds never issued"), 50)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.chunk.url.startsWith("https://acme.test"))).toBe(true)
  })

  test("two namespaces can index the same url without colliding", async () => {
    /*
     * The case the other isolation tests missed, because they gave each
     * namespace its own urls. Chunk ids are `url#position`, so two customers
     * indexing the same public docs site generate identical ids — and with id
     * as a global primary key the second ingest died on a UNIQUE constraint,
     * which looks like corruption rather than like namespacing working.
     */
    // Its own namespaces, so the page counts the prune test asserts on are
    // not disturbed by what this one inserts.
    const shared = page("https://shared.test/docs/pricing", "Pricing")
    await store.upsertPage("tenant-a", shared, [
      chunk(shared, ["Plans"], "Tenant A sees the enterprise plan."),
    ])
    await store.upsertPage("tenant-b", shared, [
      chunk(shared, ["Plans"], "Tenant B sees the starter plan."),
    ])

    const a = await store.searchKeyword("tenant-a", "plan", 50)
    const b = await store.searchKeyword("tenant-b", "plan", 50)

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]!.chunk.text).toContain("enterprise")
    expect(b[0]!.chunk.text).toContain("starter")
  })

  test("a page hash from one namespace is invisible to another", async () => {
    expect(await store.pageHash("acme", billing.url)).toBe(billing.hash)
    expect(await store.pageHash("rival", billing.url)).toBeUndefined()
  })
})

describe("keyword retrieval", () => {
  test("finds an exact error code, which vectors are bad at", async () => {
    const hits = await store.searchKeyword("acme", "SSO_REDIRECT_MISMATCH", 10)
    expect(hits[0]?.chunk.headings).toEqual(["SSO"])
  })

  test("matches heading text the body never repeats", async () => {
    const hits = await store.searchKeyword("acme", "invoices", 10)
    expect(hits.some((hit) => hit.chunk.headings[0] === "Invoices")).toBe(true)
  })

  test("survives punctuation a visitor would actually type", async () => {
    // FTS5 has its own query syntax; `?`, `*` and `(` are operators in it.
    // An unescaped question would be a syntax error rather than a search.
    const hits = await store.searchKeyword("acme", "what's the refund policy? (30 days*)", 10)
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe("ingest idempotence", () => {
  test("re-ingesting a page replaces its chunks rather than duplicating them", async () => {
    const updated = page(billing.url, "Billing")
    updated.hash = "hash-updated"
    await store.upsertPage("acme", updated, [
      chunk(updated, ["Refunds"], "Refunds now take 14 days."),
    ])

    const hits = (await store.searchKeyword("acme", "refunds", 50)).filter(
      (hit) => hit.chunk.url === billing.url
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]!.chunk.text).toContain("14 days")
  })

  test("pruning drops pages the crawl no longer sees and keeps the rest", async () => {
    expect(await store.removePagesNotIn("acme", [billing.url])).toBe(1)
    expect(await store.pageHash("acme", billing.url)).toBe("hash-updated")
    expect(await store.pageHash("acme", errors.url)).toBeUndefined()
  })
})

describe("clearing", () => {
  test("empties one namespace and leaves the others alone", async () => {
    await store.clear("acme")
    expect(await store.stats("acme")).toHaveLength(0)
    expect(await store.stats("rival")).toHaveLength(1)
  })
})
