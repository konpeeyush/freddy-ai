import type { z } from "zod"

import {
  AppendMessageRequestSchema,
  AppendMessageResponseSchema,
  ChatErrorSchema,
  DEFAULT_TENANT,
  IngestEventSchema,
  ListConversationsResponseSchema,
  ListDocumentsResponseSchema,
  PollMessagesResponseSchema,
  RagSourcesResponseSchema,
  TenantSettingsSchema,
  UploadDocumentResponseSchema,
  WidgetEnvelopeSchema,
  type ChatMessage,
  type ClientTool,
  type Conversation,
  type ConversationStatus,
  type IngestEvent,
  type StreamEvent,
  type TenantSettings,
} from "./schema"

/**
 * Transport for the backend.
 *
 * Deliberately framework-free — no React, no TanStack Query — so it stays
 * importable from the server and testable without a DOM. `streamChat` yields
 * chunks as they arrive; everything else here is a plain request/response
 * call, since none of the new persistence endpoints stream.
 */

export class ChatRequestError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.name = "ChatRequestError"
    this.status = status
    this.retryable = retryable
  }
}

/** Thrown when the caller aborts; separate so the UI can stay silent. */
export class ChatAbortError extends Error {
  constructor() {
    super("aborted")
    this.name = "ChatAbortError"
  }
}

export type StreamChatOptions = {
  url: string
  messages: ChatMessage[]
  signal?: AbortSignal
  /**
   * Restricts which tools reach the model this turn. Omit for the server's
   * default set — only the dev harness sends this.
   */
  tools?: string[]
  /**
   * Definitions for tools the page executes itself. Sent every turn: the
   * server holds no registry, so a tool absent from this list simply does
   * not exist as far as the model is concerned.
   */
  clientTools?: ClientTool[]
  /**
   * Forces a tool call this turn. Set while a sequence is running, so the
   * model cannot answer in prose and leave the step unstarted.
   */
  toolChoice?: "auto" | "required" | "none"
  /** Extra system-prompt line for this turn only. See `ChatRequestSchema`. */
  turnInstruction?: string
  /** Which knowledge base retrieval may read. See `ChatRequestSchema`. */
  tenantId?: string
}

/**
 * POSTs the conversation and yields events as they stream in.
 *
 * ```ts
 * for await (const event of streamChat({ url, messages })) {
 *   if (event.kind === "text") setReply((c) => c + event.delta)
 * }
 * ```
 */
export async function* streamChat({
  url,
  messages,
  signal,
  tools,
  clientTools,
  toolChoice,
  turnInstruction,
  tenantId,
}: StreamChatOptions): AsyncGenerator<StreamEvent, void, unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        // Omitted rather than null when unset, so the server can tell "use
        // your defaults" from "enable nothing".
        ...(tools ? { tools } : {}),
        ...(clientTools?.length ? { clientTools } : {}),
        ...(toolChoice ? { toolChoice } : {}),
        ...(turnInstruction ? { turnInstruction } : {}),
        ...(tenantId ? { tenantId } : {}),
      }),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw new ChatAbortError()
    // Network-level failure: DNS, offline, CORS preflight rejected.
    throw new ChatRequestError(
      cause instanceof Error ? cause.message : "network error",
      0,
      true
    )
  }

  if (!response.ok) {
    // Errors come back as JSON even though success is a text stream.
    const parsed = ChatErrorSchema.safeParse(
      await response.json().catch(() => null)
    )
    throw new ChatRequestError(
      parsed.success
        ? parsed.data.error
        : `request failed (${response.status})`,
      response.status,
      parsed.success ? parsed.data.retryable : response.status >= 500
    )
  }

  if (!response.body) {
    throw new ChatRequestError("empty response body", response.status, true)
  }

  /*
   * Tool calls still waiting on a result when the stream ends.
   *
   * The server registers page-defined tools with a schema but no
   * implementation, so the model's call reaches us unanswered. That is the
   * signal to run the handler here and send the transcript again.
   */
  const pending = new Map<
    string,
    { tool: string; input: unknown; providerOptions?: Record<string, unknown> }
  >()

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()

  /*
   * SSE frames arrive split across network chunks, so a partial line has to
   * be carried forward rather than parsed and dropped.
   */
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      // Break rather than return: tool calls left unanswered are emitted
      // after the loop, and returning here would skip them.
      if (done) break
      if (!value) continue

      buffer += value
      const lines = buffer.split("\n")
      // The last element is whatever came after the final newline — possibly
      // half a frame, so it stays in the buffer.
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === "[DONE]") continue

        let part: { type?: string; [key: string]: unknown }
        try {
          part = JSON.parse(payload)
        } catch {
          // A frame we cannot read is not worth killing the stream over.
          continue
        }

        switch (part.type) {
          case "text-delta":
            if (typeof part.delta === "string" && part.delta) {
              yield { kind: "text", delta: part.delta }
            }
            break
          case "tool-input-available": {
            const id = String(part.toolCallId)
            /*
             * A tool registered without an implementation produces a call and
             * nothing else. We cannot tell that apart from a slow server tool
             * until the stream ends, so record it and settle up at the end.
             */
            pending.set(id, {
              tool: String(part.toolName),
              input: part.input,
              /*
               * Kept because Gemini 3 signs its tool calls and rejects a
               * replay whose signature went missing. Opaque to us.
               */
              providerOptions: part.providerMetadata as
                | Record<string, unknown>
                | undefined,
            })
            yield {
              kind: "tool-start",
              id,
              tool: String(part.toolName),
              input: part.input,
            }
            break
          }
          case "tool-output-available": {
            pending.delete(String(part.toolCallId))
            /*
             * A tool can return a widget instead of prose. Recognising it here
             * rather than in the UI means the panel never has to sniff tool
             * results, and a malformed envelope degrades to an ordinary
             * tool-end rather than breaking the turn.
             */
            const envelope = WidgetEnvelopeSchema.safeParse(part.output)
            if (envelope.success) {
              yield {
                kind: "widget",
                id: String(part.toolCallId),
                widgetId: envelope.data.widgetId,
                version: envelope.data.version,
                data: envelope.data.data,
                summary: envelope.data.summary,
              }
              break
            }
            yield {
              kind: "tool-end",
              id: String(part.toolCallId),
              output: part.output,
            }
            break
          }
          case "error":
            throw new ChatRequestError(
              typeof part.errorText === "string"
                ? part.errorText
                : "the assistant failed mid-reply",
              response.status,
              true
            )
          // start / start-step / text-start / finish and friends carry no
          // information the UI needs.
        }
      }
    }

    /*
     * Anything still unanswered is a tool the page owns. Emitted last, once
     * the stream has closed, because only then is "no result came" certain.
     */
    for (const [id, call] of pending) {
      yield {
        kind: "client-tool-call",
        id,
        tool: call.tool,
        input: call.input,
        providerOptions: call.providerOptions,
      }
    }
  } catch (cause) {
    if (cause instanceof ChatRequestError) throw cause
    if (signal?.aborted) throw new ChatAbortError()
    throw new ChatRequestError(
      cause instanceof Error ? cause.message : "stream failed",
      response.status,
      true
    )
  } finally {
    // Releasing matters on abort: without it the connection can stay open.
    reader.releaseLock()
    if (signal?.aborted) await response.body.cancel().catch(() => {})
  }
}

/* =========================================================================
 * Conversations, messages, documents.
 *
 * Plain request/response, no streaming. Shares `ChatRequestError` with
 * `streamChat` above rather than introducing a second error type — the shape
 * (status + retryable) is generic HTTP, not chat-specific.
 * ========================================================================= */

/**
 * The dashboard's shared password (see `packages/backend/src/auth.ts`),
 * attached to every request once set. Not something the widget ever calls —
 * `/chat` and the widget's own message endpoints aren't gated by it, so a
 * widget page simply never calls `setDashboardAuthKey` and this stays
 * `null` for it, same as before this existed.
 */
let dashboardAuthKey: string | null = null

export function setDashboardAuthKey(key: string | null): void {
  dashboardAuthKey = key
}

function withAuthHeader(headers?: HeadersInit): HeadersInit | undefined {
  if (!dashboardAuthKey) return headers
  return { ...(headers as Record<string, string> | undefined), "x-dashboard-key": dashboardAuthKey }
}

async function request<T>(
  url: string,
  init: RequestInit,
  parse: (data: unknown) => T,
  signal?: AbortSignal
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: withAuthHeader(init.headers),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw new ChatAbortError()
    throw new ChatRequestError(
      cause instanceof Error ? cause.message : "network error",
      0,
      true
    )
  }

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    const parsed = ChatErrorSchema.safeParse(body)
    throw new ChatRequestError(
      parsed.success
        ? parsed.data.error
        : `request failed (${response.status})`,
      response.status,
      parsed.success ? parsed.data.retryable : response.status >= 500
    )
  }

  return parse(body)
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

/**
 * Input, not inferred output: `tenantId` carries a zod `.default()`, which
 * makes it non-optional in the *parsed* request but should stay optional for
 * a caller that just wants the default applied server-side.
 */
export type AppendMessageOptions = z.input<typeof AppendMessageRequestSchema> & {
  baseUrl: string
}

/** Records one message, creating the conversation on first contact. Called
 *  by the widget after every committed message, and by the dashboard when an
 *  operator replies. Failures should generally be swallowed by the caller —
 *  persistence must never block the live chat experience. */
export async function appendMessage(
  conversationId: string,
  { baseUrl, ...body }: AppendMessageOptions,
  signal?: AbortSignal
) {
  return request(
    `${baseUrl}/conversations/${conversationId}/messages`,
    jsonInit("POST", body),
    (data) => AppendMessageResponseSchema.parse(data),
    signal
  )
}

/** The polling endpoint. Pass `after` (the newest `createdAt` already seen)
 *  to fetch only what's new; omit it for the full thread. */
export async function pollMessages(
  conversationId: string,
  options: { baseUrl: string; after?: number; tenantId?: string },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (options.after !== undefined) params.set("after", String(options.after))
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/conversations/${conversationId}/messages?${params}`,
    { method: "GET" },
    (data) => PollMessagesResponseSchema.parse(data),
    signal
  )
}

export async function listConversations(
  options: {
    baseUrl: string
    tenantId?: string
    status?: ConversationStatus
    cursor?: string
    limit?: number
  },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  if (options.status) params.set("status", options.status)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit) params.set("limit", String(options.limit))
  return request(
    `${options.baseUrl}/conversations?${params}`,
    { method: "GET" },
    (data) => ListConversationsResponseSchema.parse(data),
    signal
  )
}

export async function getConversation(
  conversationId: string,
  options: { baseUrl: string; tenantId?: string },
  signal?: AbortSignal
): Promise<Conversation> {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/conversations/${conversationId}?${params}`,
    { method: "GET" },
    (data) => (data as { conversation: Conversation }).conversation,
    signal
  )
}

export async function updateConversationStatus(
  conversationId: string,
  options: { baseUrl: string; status: ConversationStatus; tenantId?: string },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/conversations/${conversationId}/status?${params}`,
    jsonInit("PATCH", { status: options.status }),
    (data) => data as { ok: true },
    signal
  )
}

export async function uploadDocument(
  options: {
    baseUrl: string
    file: File | Blob
    filename?: string
    category?: string
    tenantId?: string
  },
  signal?: AbortSignal
) {
  const form = new FormData()
  form.set("file", options.file, options.filename)
  if (options.category) form.set("category", options.category)
  form.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/documents`,
    { method: "POST", body: form },
    (data) => UploadDocumentResponseSchema.parse(data),
    signal
  )
}

export async function listDocuments(
  options: { baseUrl: string; tenantId?: string; cursor?: string; limit?: number },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  if (options.cursor) params.set("cursor", options.cursor)
  if (options.limit) params.set("limit", String(options.limit))
  return request(
    `${options.baseUrl}/documents?${params}`,
    { method: "GET" },
    (data) => ListDocumentsResponseSchema.parse(data),
    signal
  )
}

export async function deleteDocument(
  documentId: string,
  options: { baseUrl: string; tenantId?: string },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/documents/${documentId}?${params}`,
    { method: "DELETE" },
    (data) => data as { ok: true },
    signal
  )
}

/* =========================================================================
 * Links — crawling a site into the knowledge base, alongside the document
 * upload path above. `ingestUrl` is the one streaming call in this file
 * outside `streamChat`; the rest are plain request/response.
 * ========================================================================= */

/**
 * Reads a server-sent event stream as parsed, schema-validated objects.
 *
 * Hand-rolled rather than `EventSource`, which only issues GETs and so
 * cannot carry the ingest request in a body. The buffering matters: a chunk
 * boundary lands mid-event often enough that parsing per-read rather than
 * per-event drops roughly one event in twenty, which would show up as a
 * progress count that skips numbers. Ported from the same logic in
 * `apps/chatbot/dev/rag.ts`, generalized to validate each frame against a
 * schema rather than trusting the JSON as-is.
 */
async function* readSseEvents<T>(
  response: Response,
  parse: (data: unknown) => T,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        const line = frame
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim()
        if (!line) continue
        try {
          yield parse(JSON.parse(line))
        } catch {
          // A truncated frame, or one that fails validation, is not worth
          // aborting a crawl over.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export type IngestUrlOptions = {
  baseUrl: string
  url: string
  tenantId?: string
  maxPages?: number
  prune?: boolean
}

/**
 * Crawls and indexes a site, yielding progress events as they stream in.
 *
 * Unlike every other call in this file, a non-2xx response here is reported
 * as one final `{kind: "error"}` event rather than a thrown
 * `ChatRequestError` — the server can 400 before ever opening the SSE
 * stream (a malformed body), and folding that into the same event union a
 * caller already switches over means one code path handles both, instead of
 * a try/catch wrapped around the whole generator.
 */
export async function* ingestUrl(
  options: IngestUrlOptions,
  signal?: AbortSignal
): AsyncGenerator<IngestEvent> {
  let response: Response
  try {
    const init = jsonInit("POST", {
      url: options.url,
      tenantId: options.tenantId ?? DEFAULT_TENANT,
      maxPages: options.maxPages,
      prune: options.prune,
    })
    response = await fetch(`${options.baseUrl}/rag/ingest`, {
      ...init,
      headers: withAuthHeader(init.headers),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) return
    yield {
      kind: "error",
      message: cause instanceof Error ? cause.message : "network error",
    }
    return
  }

  if (!response.ok) {
    const parsed = ChatErrorSchema.safeParse(
      await response.json().catch(() => null)
    )
    yield {
      kind: "error",
      message: parsed.success
        ? parsed.data.error
        : `request failed (${response.status})`,
    }
    return
  }

  yield* readSseEvents(response, (data) => IngestEventSchema.parse(data), signal)
}

/** Stops an ingest mid-crawl. Idempotent — cancelling nothing is not an
 *  error, it just reports `cancelled: false`. */
export async function cancelIngest(
  options: { baseUrl: string; tenantId?: string },
  signal?: AbortSignal
) {
  return request(
    `${options.baseUrl}/rag/cancel`,
    jsonInit("POST", { tenantId: options.tenantId ?? DEFAULT_TENANT }),
    (data) => data as { cancelled: boolean },
    signal
  )
}

/** What has been crawled. `tenantId` omitted asks for every tenant, not the
 *  default one — matches `GET /rag/sources`'s own semantics. */
export async function listSources(
  options: { baseUrl: string; tenantId?: string },
  signal?: AbortSignal
) {
  const params = new URLSearchParams()
  if (options.tenantId) params.set("tenantId", options.tenantId)
  const query = params.toString()
  return request(
    `${options.baseUrl}/rag/sources${query ? `?${query}` : ""}`,
    { method: "GET" },
    (data) => RagSourcesResponseSchema.parse(data),
    signal
  )
}

/** Removes one crawled site. Distinct from clearing a whole tenant's
 *  knowledge base — everything else it holds (other sites, uploaded
 *  documents) is left alone. */
export async function deleteSource(
  options: { baseUrl: string; origin: string; tenantId?: string },
  signal?: AbortSignal
) {
  return request(
    `${options.baseUrl}/rag/sources/delete`,
    jsonInit("POST", {
      origin: options.origin,
      tenantId: options.tenantId ?? DEFAULT_TENANT,
    }),
    (data) => data as { ok: true; removed: number },
    signal
  )
}

/* =========================================================================
 * Settings — the persona/restrictions `/chat` layers onto its system
 * prompt for every turn.
 * ========================================================================= */

export async function getSettings(
  options: { baseUrl: string; tenantId?: string },
  signal?: AbortSignal
): Promise<TenantSettings> {
  const params = new URLSearchParams()
  params.set("tenantId", options.tenantId ?? DEFAULT_TENANT)
  return request(
    `${options.baseUrl}/settings?${params}`,
    { method: "GET" },
    (data) => TenantSettingsSchema.parse(data),
    signal
  )
}

export async function updateSettings(
  options: { baseUrl: string; tenantId?: string; persona: string; restrictions: string },
  signal?: AbortSignal
): Promise<TenantSettings> {
  return request(
    `${options.baseUrl}/settings`,
    jsonInit("POST", {
      tenantId: options.tenantId ?? DEFAULT_TENANT,
      persona: options.persona,
      restrictions: options.restrictions,
    }),
    (data) => TenantSettingsSchema.parse(data),
    signal
  )
}
