import { randomUUID, createHash } from "node:crypto"

import { chunkPage, embedChunks, embeddingModelId, type Page } from "@workspace/rag"
import { EmbeddingModelMismatch } from "@workspace/rag"

import type { DbAdapter } from "./adapter"
import { store } from "./db"

/*
 * Direct file uploads into the knowledge base.
 *
 * `packages/rag`'s own pipeline is crawl → extract → chunk → embed → store,
 * built around fetching HTML. An upload skips the first two stages — the
 * text is already in hand — and joins the pipeline at `chunkPage`, reusing
 * the same chunker, embedder and store the URL-crawl path uses. A document
 * therefore competes for retrieval on equal footing with a crawled page; the
 * `documents` table below exists only so the dashboard has something to list,
 * not because search treats the two differently.
 */

export type DocumentRow = {
  id: string
  tenant_id: string
  filename: string
  category: string | null
  source: "upload" | "crawl"
  mime_type: string
  size_bytes: number
  status: "processing" | "ready" | "failed"
  error: string | null
  page_url: string
  chunk_count: number
  created_at: number
  updated_at: number
}

function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`, "utf-8").toString("base64url")
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  const [ts, ...rest] = Buffer.from(cursor, "base64url")
    .toString("utf-8")
    .split(":")
  return { createdAt: Number(ts), id: rest.join(":") }
}

export async function getDocument(
  db: DbAdapter,
  tenantId: string,
  id: string
): Promise<DocumentRow | undefined> {
  return db.get<DocumentRow>(
    "SELECT * FROM documents WHERE tenant_id = ? AND id = ?",
    [tenantId, id]
  )
}

export async function listDocuments(
  db: DbAdapter,
  tenantId: string,
  options: { cursor?: string; limit: number }
): Promise<{ items: DocumentRow[]; nextCursor?: string }> {
  const conditions = ["tenant_id = ?"]
  const params: (string | number)[] = [tenantId]

  if (options.cursor) {
    const { createdAt, id } = decodeCursor(options.cursor)
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))")
    params.push(createdAt, createdAt, id)
  }

  const rows = await db.all<DocumentRow>(
    `SELECT * FROM documents WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    [...params, options.limit + 1]
  )

  const hasMore = rows.length > options.limit
  const items = hasMore ? rows.slice(0, options.limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : undefined,
  }
}

/**
 * Text extraction by file type.
 *
 * `.txt`/`.md`/`.csv` decode directly — a CSV is flat text to the chunker,
 * which degrades gracefully to one un-headinged section; acceptable for v1,
 * a dedicated tabular-data path is future work. `.pdf` goes through
 * `pdf-parse`, text-only — no OCR, so a scanned or image-heavy PDF yields
 * little or nothing. That limitation is surfaced in the dashboard's upload
 * dialog copy, not hidden here.
 */
async function extractText(
  filename: string,
  mimeType: string,
  bytes: Buffer
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? ""
  if (mimeType === "application/pdf" || ext === "pdf") {
    const { default: pdfParse } = await import("pdf-parse")
    const parsed = await pdfParse(bytes)
    return parsed.text
  }
  return bytes.toString("utf-8")
}

/**
 * Uploads and synchronously ingests one file.
 *
 * Synchronous rather than an SSE progress stream like `/rag/ingest`: a
 * single small file embeds in well under a second, so the extra machinery a
 * multi-minute site crawl needs would be pure overhead here.
 */
export async function addDocument(
  db: DbAdapter,
  tenantId: string,
  input: {
    bytes: Buffer
    filename: string
    mimeType: string
    category?: string
  }
): Promise<DocumentRow> {
  const id = randomUUID()
  const now = Date.now()
  const pageUrl = `upload://${tenantId}/${id}`

  await db.run(
    `INSERT INTO documents
       (id, tenant_id, filename, category, source, mime_type, size_bytes, status, error, page_url, chunk_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'upload', ?, ?, 'processing', NULL, ?, 0, ?, ?)`,
    [
      id,
      tenantId,
      input.filename,
      input.category ?? null,
      input.mimeType,
      input.bytes.length,
      pageUrl,
      now,
      now,
    ]
  )

  try {
    const text = (await extractText(input.filename, input.mimeType, input.bytes)).trim()
    if (!text) throw new Error("no extractable text found in this file")

    const page: Page = {
      url: pageUrl,
      title: input.filename,
      markdown: text,
      hash: createHash("sha256").update(text).digest("hex"),
      fetchedAt: now,
    }
    const chunks = chunkPage(page)
    if (!chunks.length) throw new Error("file produced no retrievable content")

    // Same guard `ingest()` runs before a crawl: refuse to extend an index
    // built by a different embedding model rather than silently corrupting
    // search results with mixed vectors.
    const model = embeddingModelId()
    const existingModel = await store.indexModel(tenantId)
    if (existingModel && existingModel !== model) {
      throw new EmbeddingModelMismatch(existingModel, model)
    }
    await store.setIndexModel(tenantId, model)

    const embedded = await embedChunks(chunks)
    await store.upsertPage(tenantId, page, embedded.chunks)

    await db.run(
      "UPDATE documents SET status = 'ready', chunk_count = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [embedded.chunks.length, Date.now(), tenantId, id]
    )
  } catch (cause) {
    console.error("document ingest failed:", cause)
    await db.run(
      "UPDATE documents SET status = 'failed', error = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
      [cause instanceof Error ? cause.message : "processing failed", Date.now(), tenantId, id]
    )
  }

  return (await getDocument(db, tenantId, id))!
}

export async function deleteDocument(
  db: DbAdapter,
  tenantId: string,
  id: string
): Promise<boolean> {
  const doc = await getDocument(db, tenantId, id)
  if (!doc) return false
  await store.deletePage(tenantId, doc.page_url)
  await db.run("DELETE FROM documents WHERE tenant_id = ? AND id = ?", [tenantId, id])
  return true
}
