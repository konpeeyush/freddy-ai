import { google } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { embed, embedMany, type EmbeddingModel } from "ai"

import { embeddable } from "./chunk"
import { resolveProvider } from "./provider"
import type { Chunk, EmbeddedChunk } from "./types"

/**
 * 768 dimensions, whichever backend is in use.
 *
 * Native for `nomic-embed-text`; a Matryoshka truncation of Gemini's 3072.
 * Matching them is convenient — the stored vectors are the same width either
 * way — and also the reason `indexModel` below exists, since two different
 * models producing identically shaped vectors is exactly the situation where
 * a mixed index returns nonsense instead of an error.
 */
export const DIMENSIONS = 768

const GOOGLE_MODEL = "gemini-embedding-001"
const OLLAMA_MODEL = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text"

/** Which side of the pair is being embedded. They are not symmetric. */
type Target = "document" | "query"

type Backend = {
  /** Identifies the vectors this produces. Stored with the index. */
  id: string
  model: EmbeddingModel
  /** Provider-specific knobs. Meaningless to send to the wrong provider. */
  providerOptions?: Record<string, Record<string, string | number>>
  /** Prepended to the text before embedding. */
  prefix: string
}

/**
 * Picks the embedding backend from `resolveProvider()` — the same resolution
 * (and validation) the server's chat model uses, so the two cannot silently
 * disagree about which provider is configured. See `./provider`.
 *
 * Embeddings written by one backend are not interchangeable with another's —
 * see `embeddingModelId` — which is exactly why this cannot resolve the
 * provider its own way: a value `resolveProvider` rejects as invalid must
 * fail the same way here as it does for chat, not silently fall back to
 * Google while chat logs an error and does the same.
 */
function backend(target: Target): Backend {
  const provider = resolveProvider()

  if (provider === "ollama") {
    return {
      id: `ollama/${OLLAMA_MODEL}`,
      model: createOpenAICompatible({
        name: "ollama",
        baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      }).embeddingModel(OLLAMA_MODEL),
      /*
       * Nomic's models are trained with these literal prefixes, and they do
       * the job Gemini's `taskType` does: tell the model which half of a
       * question/answer pair it is looking at. Omitting them is not an error,
       * it just quietly costs recall — the same trap as using one task type
       * for both sides.
       */
      prefix: target === "document" ? "search_document: " : "search_query: ",
    }
  }

  return {
    id: `google/${GOOGLE_MODEL}`,
    model: google.embedding(GOOGLE_MODEL),
    providerOptions: {
      google: {
        taskType:
          target === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
        outputDimensionality: DIMENSIONS,
      },
    },
    prefix: "",
  }
}

/**
 * Names the vectors the current configuration produces.
 *
 * Recorded against an index when it is built and checked before it is read.
 * Both backends emit 768 floats, so a query embedded by one against chunks
 * embedded by the other is not a crash and not an empty result — it is a
 * confidently ranked list of unrelated passages, which is the single most
 * expensive way for this to fail.
 */
export function embeddingModelId(): string {
  return backend("query").id
}

/** Unit-length in place. See the note above on why this is not optional. */
export function normalize(vector: number[]): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const length = Math.sqrt(sum) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / length
  return out
}

/** Cosine of two already-normalised vectors, which is just the dot product. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

export type EmbedResult = { chunks: EmbeddedChunk[]; tokens: number }

/**
 * Embeds chunks in batches.
 *
 * Batched at 96 because Google's batch endpoint rejects larger payloads, and
 * `maxParallelCalls` is held low deliberately: an ingest is a background job
 * competing with live chat traffic for the same per-minute quota, and a burst
 * here surfaces as a visitor's message failing.
 */
export async function embedChunks(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<EmbedResult> {
  const out: EmbeddedChunk[] = []
  let tokens = 0
  const BATCH = 96

  const side = backend("document")

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH)
    const { embeddings, usage } = await embedMany({
      model: side.model,
      values: batch.map((chunk) => side.prefix + embeddable(chunk)),
      maxParallelCalls: 2,
      abortSignal: signal,
      ...(side.providerOptions
        ? { providerOptions: side.providerOptions }
        : {}),
    })
    /*
     * Guarded rather than added straight in. Not every provider reports token
     * usage for embeddings — Google's returns nothing here — and one
     * `undefined` turns the running total into NaN, which serialises to `null`
     * and then throws in the browser at `.toLocaleString()`. A missing count
     * should read as zero, not take the progress log down with it.
     */
    const used = usage?.tokens
    if (typeof used === "number" && Number.isFinite(used)) tokens += used
    embeddings.forEach((embedding, index) => {
      out.push({ ...batch[index]!, embedding: normalize(embedding) })
    })
    onProgress?.(Math.min(i + BATCH, chunks.length), chunks.length)
  }

  return { chunks: out, tokens }
}

/** The query side of the pair. Note the different task type. */
export async function embedQuery(
  query: string,
  signal?: AbortSignal
): Promise<Float32Array> {
  const side = backend("query")
  const { embedding } = await embed({
    model: side.model,
    value: side.prefix + query,
    abortSignal: signal,
    ...(side.providerOptions ? { providerOptions: side.providerOptions } : {}),
  })
  return normalize(embedding)
}
