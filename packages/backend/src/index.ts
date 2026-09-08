import { serve } from "@hono/node-server"
import {
  createUIMessageStreamResponse,
  isStepCount,
  smoothStream,
  streamText,
  toUIMessageStream,
} from "ai"
import { Hono } from "hono"
import { cors } from "hono/cors"

import {
  AppendMessageRequestSchema,
  ChatRequestSchema,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TENANT,
  DeleteSourceRequestSchema,
  DraftToolRequestSchema,
  RagIngestRequestSchema,
  RagSearchRequestSchema,
  SequenceSourceSchema,
  TenantIdSchema,
  UpdateConversationStatusRequestSchema,
  UpdateSettingsRequestSchema,
  type Conversation,
  type ConversationStatus,
  type Document,
  type StoredMessage,
} from "@workspace/api/schema"
import { EmbeddingModelMismatch } from "@workspace/rag"

import { draftTool } from "./draft"
import { fetchFavicon, isValidDomain } from "./favicon"
import { repairToolCall } from "./repair"
import { compileSequence, SequenceAuthorError } from "./sequence"
import { toModelMessages } from "./history"
import { chatModel, isConfigured, modelLabel, provider } from "./model"
import { db } from "./db"
import * as Conversations from "./conversations"
import * as Documents from "./documents"
import { getSettings, upsertSettings } from "./settings"
import { requireDashboardAuth } from "./auth"

import {
  cancelIngest,
  deleteSource,
  ingestRunning,
  ingestStream,
  ragSearch,
  ragSources,
  ragStore,
} from "./rag"
import { clientTools } from "./tools/client"
import { resolveTools, TOOL_META } from "./tools"

/*
 * Backend: chat + RAG (ported from chatbot-sdk's server, unmodified contract)
 * plus conversations/documents (new — see conversations.ts/documents.ts for
 * why they exist).
 *
 * Exists because the API key cannot ship in the widget — that bundle runs on
 * customers' pages, where anything in it is readable. The widget talks to
 * this; this talks to Gemini.
 */

/*
 * gemini-3.1-flash-lite: cheapest generally-available tier ($0.25/$1.50 per 1M
 * vs $0.75/$3.75 for 3.6-flash) and ~5x faster to first token, which matters
 * more than raw capability for short support replies.
 *
 * Verify a model still accepts new keys before switching — 2.5-flash and
 * 2.5-flash-lite both fail with "no longer available to new users".
 */
const MODEL = "gemini-3.1-flash-lite"

const SYSTEM_PROMPT = `You are a helpful customer-support assistant embedded in a chat widget.

Keep replies short — a sentence or two unless detail is genuinely needed.
Use markdown when it aids scanning (lists, bold, tables), but do not decorate
plain answers with it. Never invent order numbers, prices, or policies: if you
do not know something, say so and offer to hand off to a person.

When a knowledge base is available you have a search tool over the site's own
documentation and FAQs. Use it before answering anything about the product,
pricing, plans, policies, limits or setup — including questions you are
confident about, because what you remember about a product is usually a
different version of it than the one you are answering for. Answer from the
passages it returns. Cite each one inline right after the sentence it
supports, using its bracketed index like [1] or [2] — never write out the
url. If it finds nothing, say the docs do not
cover it and offer a handoff; do not fill the gap from memory.

Some tools render an interactive card the visitor can see and act on. When a
tool result says it showed one, the visitor is already looking at it — do not
repeat its contents in prose. Add one short line and stop, or ask what they
want to do next. Restating a card the visitor can read is the single most
common way these replies go wrong.

That rule is about cards only. A tool returning plain data — the knowledge
search does — shows the visitor nothing at all, so its results exist for you
alone and you do have to write them up.

A card that collects input has not been submitted just because you showed it.
Never thank someone for details they have not sent.`

/*
 * Whether the configured provider can actually be reached. Which key that
 * needs — or whether it needs one at all — depends on `MODEL_PROVIDER`, so
 * the question is asked of `./model` rather than of a specific variable.
 */
const apiKey = isConfigured()
if (!apiKey) {
  console.error(
    `MODEL_PROVIDER=${provider} has no key set — /chat and /rag/* will return 500.\n` +
      "See packages/backend/.env.example for what each provider needs."
  )
}

/** The one place every route reports "no API key configured". */
function missingApiKey() {
  return { error: "server is missing its API key", retryable: false } as const
}

function toConversation(row: Conversations.ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    visitorMeta: row.visitor_meta ? JSON.parse(row.visitor_meta) : undefined,
    lastMessagePreview: row.last_message_preview ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toStoredMessage(row: Conversations.MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role,
    sender: row.sender,
    text: row.text,
    parts: row.parts ? JSON.parse(row.parts) : undefined,
    sources: row.sources ? JSON.parse(row.sources) : undefined,
    createdAt: row.created_at,
  }
}

function toDocument(row: Documents.DocumentRow): Document {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    filename: row.filename,
    category: row.category ?? undefined,
    source: row.source,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    error: row.error ?? undefined,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const app = new Hono()

/*
 * Wide-open CORS is the point: the widget loads on domains we do not control,
 * so an allowlist would have to be per-customer. That gate belongs with auth,
 * which this iteration does not have — it applies to the dashboard's calls
 * too, for the same reason.
 */
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
)

app.get("/health", (c) =>
  c.json({ ok: true, model: modelLabel(MODEL), provider, configured: apiKey })
)

/*
 * What the server itself brings.
 *
 * Almost everything comes from the page — see `./tools/client` — so this lists
 * only the tools that cannot: currently `searchKnowledge`, which needs the
 * provider key and the vector index, neither of which belongs in a browser.
 */
app.get("/tools", (c) => c.json({ tools: TOOL_META }))

/*
 * Favicon proxy for the sources list — see `./favicon` for why this exists
 * rather than the widget just pointing an `<img>` at the cited domain.
 */
app.get("/favicon", async (c) => {
  const domain = c.req.query("domain") ?? ""
  if (!isValidDomain(domain)) {
    return c.json({ error: "invalid domain" }, 400)
  }

  const favicon = await fetchFavicon(domain)
  if (!favicon) {
    return c.json({ error: "favicon unavailable" }, 502)
  }

  return new Response(favicon.body, {
    headers: {
      "content-type": favicon.contentType,
      // A day: icons change rarely, and showing a stale one for a few hours
      // costs nothing.
      "cache-control": "public, max-age=86400",
    },
  })
})

/*
 * Drafts a tool from a sentence.
 *
 * Dev-time only: the widget's dev playground (apps/chatbot/dev) calls it so
 * a person can describe a tool and get a filled-in form back rather than
 * hand-writing JSON Schema. Nothing in the shipped widget bundle touches this.
 */
app.post("/draft-tool", async (c) => {
  const parsed = DraftToolRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  try {
    return c.json(await draftTool(MODEL, parsed.data))
  } catch (cause) {
    console.error("draft failed:", cause)
    /*
     * Retryable: drafting is one shot with no partial state, and a model that
     * returned something malformed will usually get it right when asked again.
     */
    return c.json(
      {
        error: cause instanceof Error ? cause.message : "could not draft a tool",
        retryable: true,
      },
      502
    )
  }
})

/*
 * Compiles a described flow into ordered steps.
 *
 * Dev-time only, like `/draft-tool` above and for the same reason: writing
 * the steps out by hand is the part people get wrong, and getting it wrong
 * shows up as a flow that runs in the wrong order rather than as an error.
 *
 * The compiled sequence is handed back for a person to check and edit. It is
 * not registered here — the server keeps no sequences, exactly as it keeps no
 * tools. See `./tools/client`.
 */
app.post("/compile-sequence", async (c) => {
  const parsed = SequenceSourceSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  try {
    return c.json(await compileSequence(MODEL, parsed.data))
  } catch (cause) {
    console.error("compile failed:", cause)
    /*
     * A description the compiler rejected outright — an unknown @mention, or
     * nothing that compiled to a step — is the author's to fix, and retrying
     * the same text would fail identically. Anything else is a model or
     * network failure, which usually succeeds on a second attempt.
     *
     * Typed rather than matched on wording: rewording an error would
     * otherwise flip its classification, and everything unrecognised was
     * being reported as retryable whether or not it was.
     */
    const authorError = cause instanceof SequenceAuthorError
    const message =
      cause instanceof Error ? cause.message : "could not compile that flow"

    return c.json({ error: message, retryable: !authorError }, authorError ? 400 : 502)
  }
})

/*
 * Retrieval.
 *
 * The only stateful corner of the original chat/RAG surface. Ingestion
 * crawls a customer's docs, embeds them and stores the vectors;
 * `searchKnowledge` reads them back during a chat. Both live here rather
 * than on the page because they need the provider key — see `./rag`.
 */

/**
 * Crawls and indexes a site, streaming progress as it goes.
 *
 * Server-sent events rather than a JSON reply: this takes minutes, and the
 * useful part is watching *which* pages were skipped and why. A response that
 * only arrives at the end cannot tell you your docs are client-rendered.
 */
app.post("/rag/ingest", requireDashboardAuth, async (c) => {
  const parsed = RagIngestRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    console.error(
      "rejected /rag/ingest:",
      JSON.stringify(parsed.error.issues, null, 2)
    )
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  return ingestStream({
    tenantId: parsed.data.tenantId,
    url: parsed.data.url,
    maxPages: parsed.data.maxPages,
    prune: parsed.data.prune,
    clientSignal: c.req.raw.signal,
  })
})

/** Stops an ingest mid-crawl. Idempotent — cancelling nothing is not an error. */
app.post("/rag/cancel", requireDashboardAuth, async (c) => {
  const parsed = TenantIdSchema.safeParse(
    (await c.req.json().catch(() => null))?.tenantId ?? DEFAULT_TENANT
  )
  if (!parsed.success) {
    return c.json({ error: "invalid tenant id", retryable: false }, 400)
  }
  return c.json({ cancelled: cancelIngest(parsed.data) })
})

/**
 * Search on its own, without a model in the way.
 *
 * The most useful endpoint in the whole feature while building: when the bot
 * answers badly, this says whether retrieval found the right passage and the
 * model ignored it, or never found it at all. Those have opposite fixes.
 */
app.post("/rag/search", requireDashboardAuth, async (c) => {
  const parsed = RagSearchRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  try {
    return c.json({
      hits: await ragSearch(parsed.data.tenantId, parsed.data.query, parsed.data.limit),
    })
  } catch (cause) {
    /*
     * An index built by a different embedding model is a configuration
     * problem, not a transient one — retrying sends the identical request.
     * Reported with the message the error carries, which names both models
     * and says to clear the namespace, because "search failed" would send
     * whoever reads it looking in entirely the wrong place.
     */
    if (cause instanceof EmbeddingModelMismatch) {
      return c.json({ error: cause.message, retryable: false }, 409)
    }
    console.error("search failed:", cause)
    // Retryable: the only network call here is embedding the query.
    return c.json({ error: "search failed", retryable: true }, 502)
  }
})

/**
 * What has been ingested, so the page can say what the bot actually knows.
 *
 * `tenantId` omitted means "every tenant" for both fields: `sources`
 * aggregates across all of them, and `ingesting` reports whether any tenant
 * has a crawl running rather than defaulting to just one.
 */
app.get("/rag/sources", requireDashboardAuth, async (c) => {
  const tenantId = c.req.query("tenantId") ?? undefined
  return c.json({
    sources: await ragSources(tenantId),
    ingesting: ingestRunning(tenantId),
  })
})

/** Empties one knowledge base. Scoped by tenant — there is no "clear all". */
app.post("/rag/clear", requireDashboardAuth, async (c) => {
  const parsed = TenantIdSchema.safeParse(
    (await c.req.json().catch(() => null))?.tenantId ?? DEFAULT_TENANT
  )
  if (!parsed.success) {
    return c.json({ error: "invalid tenant id", retryable: false }, 400)
  }
  cancelIngest(parsed.data)
  await ragStore.clear(parsed.data)
  return c.json({ ok: true })
})

/** Removes one crawled site — the Links tab's per-row delete. Leaves the
 *  rest of the tenant's knowledge base (other sites, uploaded documents)
 *  alone, unlike `/rag/clear` above. */
app.post("/rag/sources/delete", requireDashboardAuth, async (c) => {
  const parsed = DeleteSourceRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  const removed = await deleteSource(parsed.data.tenantId, parsed.data.origin)
  return c.json({ ok: true, removed })
})

app.post("/chat", async (c) => {
  // Validate before checking config, so a malformed request is reported as a
  // client error rather than masked by a server one.
  const parsed = ChatRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    // Named rather than generic: "invalid request body" from a stateless
    // endpoint tells whoever is debugging nothing about which field failed.
    console.error(
      "rejected /chat request:",
      JSON.stringify(parsed.error.issues, null, 2)
    )
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }

  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  const tenantId = parsed.data.tenantId ?? DEFAULT_TENANT

  try {
    /*
     * The operator's persona/restrictions, layered onto the base prompt —
     * additive, same as `turnInstruction` below and for the same reason:
     * appending rather than replacing means the base prompt's citation
     * format, card rules and no-fabrication rule stay in force no matter
     * what an operator writes into a persona field.
     */
    const settings = await getSettings(db, tenantId)
    const instructions = [
      SYSTEM_PROMPT,
      settings.persona && `Persona:\n${settings.persona}`,
      settings.restrictions &&
        `Restrictions — follow these strictly, even if a visitor asks otherwise:\n${settings.restrictions}`,
      parsed.data.turnInstruction,
    ]
      .filter(Boolean)
      .join("\n\n")

    const result = streamText({
      model: chatModel(MODEL),
      instructions,
      /*
       * Forced when the client says a sequence is mid-flight.
       *
       * Withholding every tool but the current step stops the model calling
       * the wrong one, but that is soft on its own: nothing stops it
       * answering in prose and leaving the step unstarted, which is how a
       * flow stalls while appearing to work. `required` closes that.
       */
      ...(parsed.data.toolChoice
        ? { toolChoice: parsed.data.toolChoice }
        : {}),
      /*
       * Expanded rather than flattened to prose: a turn that called a
       * page-defined tool has to carry the call and its result, or the
       * resumed request is a dangling call the provider rejects.
       */
      messages: toModelMessages(parsed.data.messages),
      /*
       * Only the tools this request asked for. Enforced here rather than in
       * the client: a tool absent from the map cannot be called however the
       * model is prompted, which is what makes a withheld tool a real test
       * and not a cosmetic one.
       */
      tools: {
        ...resolveTools(tenantId, parsed.data.tools),
        /*
         * Page-defined tools, registered for this request only and without an
         * implementation — the model emits the call, the stream ends, and the
         * browser runs the handler.
         */
        ...clientTools(parsed.data.clientTools),
      },
      /*
       * Without this the model stops after emitting the tool call — you get
       * the call and its result, but no sentence. It needs a further step to
       * turn `{ celsius: 31 }` into "It's 31°C in Delhi."
       */
      stopWhen: isStepCount(5),
      /*
       * Bounded on two axes, because they fail differently.
       *
       * `firstChunkMs` catches a model that accepts the request and then says
       * nothing — the visitor is watching a spinner, so this wants to be
       * shorter than patience. `totalMs` catches a stream that trickles
       * forever. Without either, a hung upstream call holds the request open
       * until the platform kills it, and the visitor is told nothing.
       */
      timeout: { firstChunkMs: 15_000, totalMs: 120_000 },
      /*
       * One retry. A rate limit or a 5xx is usually transient, but each
       * attempt is time a visitor spends waiting, so this is not the place
       * for a long backoff.
       */
      maxRetries: 1,
      /*
       * A malformed tool call is repaired rather than fatal.
       *
       * More likely here than in most apps: the schemas come from a
       * customer's page, and Gemini silently drops constraint keywords it
       * cannot express, so the model is working from a looser contract than
       * the author wrote. Asking it to fix its own call costs one cheap
       * round trip and saves the turn.
       */
      repairToolCall: repairToolCall(),
      /*
       * Paced here rather than in the browser.
       *
       * The widget releases text as it arrives rather than splitting on a
       * timer — which silently does nothing for Chinese, Japanese, Thai or
       * any script without spaces, dumping a whole reply in one frame. A
       * segmenter knows where words end in each of those, and the client
       * just renders what arrives.
       */
      experimental_transform: smoothStream({
        delayInMs: 28,
        chunking: new Intl.Segmenter(undefined, { granularity: "word" }),
      }),
      // Abort the upstream call when the client hangs up, so a cancelled
      // request stops costing tokens.
      abortSignal: c.req.raw.signal,
      // streamText fails asynchronously, after the response headers are
      // already out — without this the client sees an empty 200 and no reason.
      onError({ error }) {
        console.error("stream failed:", error)
      },
      /*
       * Token accounting.
       *
       * `cacheReadTokens` is the number worth watching: the system prompt and
       * every client tool definition are re-sent on each round of the resume
       * loop, so a conversation that uses tools pays for them repeatedly
       * unless the provider is caching them. Nothing else here reports that.
       */
      onEnd({ usage }) {
        console.log("usage:", {
          in: usage?.inputTokens,
          out: usage?.outputTokens,
          cacheRead: usage?.inputTokenDetails?.cacheReadTokens,
          reasoning: usage?.outputTokenDetails?.reasoningTokens,
        })
      },
      /*
       * A visitor closing the tab is not a failure — but it is not a finished
       * turn either, and counting it as one would quietly inflate whatever
       * the numbers above are used for.
       */
      onAbort() {
        console.log("stream aborted by the client")
      },
    })

    /*
     * Framed parts, not raw text. A tool call has no place in a plain string,
     * so the transport carries typed chunks: text deltas, tool calls, tool
     * results, errors.
     */
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    })
  } catch (cause) {
    console.error("chat failed:", cause)
    return c.json({ error: "upstream request failed", retryable: true }, 502)
  }
})

/* =========================================================================
 * Conversations — new structure around the stateless chat above. See
 * conversations.ts for the schema and the reasoning.
 * ========================================================================= */

app.post("/conversations/:conversationId/messages", async (c) => {
  const parsed = AppendMessageRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }

  const conversationId = c.req.param("conversationId")
  const row = await Conversations.appendMessage(
    db,
    parsed.data.tenantId,
    conversationId,
    parsed.data.message,
    parsed.data.visitorMeta
  )
  return c.json({ ok: true, conversation: toConversation(row) })
})

app.get("/conversations/:conversationId/messages", async (c) => {
  const conversationId = c.req.param("conversationId")
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  const afterParam = c.req.query("after")
  const after = afterParam ? Number(afterParam) : undefined

  const rows = await Conversations.getMessagesSince(db, tenantId, conversationId, after)
  const conversation = await Conversations.getConversation(db, tenantId, conversationId)

  return c.json({
    messages: rows.map(toStoredMessage),
    conversationStatus: conversation?.status ?? "unresolved",
  })
})

app.get("/conversations", requireDashboardAuth, async (c) => {
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  const status = (c.req.query("status") as ConversationStatus | undefined) ?? undefined
  const cursor = c.req.query("cursor") ?? undefined
  const limit = Number(c.req.query("limit") ?? DEFAULT_PAGE_SIZE)

  const { items, nextCursor } = await Conversations.listConversations(db, tenantId, {
    status,
    cursor,
    limit,
  })
  return c.json({ items: items.map(toConversation), nextCursor })
})

app.get("/conversations/:conversationId", requireDashboardAuth, async (c) => {
  const conversationId = c.req.param("conversationId")
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT

  const row = await Conversations.getConversation(db, tenantId, conversationId)
  if (!row) {
    return c.json({ error: "conversation not found", retryable: false }, 404)
  }
  return c.json({ conversation: toConversation(row) })
})

app.patch("/conversations/:conversationId/status", requireDashboardAuth, async (c) => {
  const parsed = UpdateConversationStatusRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }

  const conversationId = c.req.param("conversationId")
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  const ok = await Conversations.updateConversationStatus(
    db,
    tenantId,
    conversationId,
    parsed.data.status
  )
  if (!ok) {
    return c.json({ error: "conversation not found", retryable: false }, 404)
  }
  return c.json({ ok: true })
})

/* =========================================================================
 * Documents — the knowledge-base manager's upload path, sitting alongside
 * the existing /rag/ingest crawl path. See documents.ts.
 * ========================================================================= */

app.post("/documents", requireDashboardAuth, async (c) => {
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.file
  if (!(file instanceof File)) {
    return c.json({ error: "missing file", retryable: false }, 400)
  }
  if (!apiKey) {
    return c.json(missingApiKey(), 500)
  }

  const tenantId = typeof body?.tenantId === "string" ? body.tenantId : DEFAULT_TENANT
  const category = typeof body?.category === "string" ? body.category : undefined
  const bytes = Buffer.from(await file.arrayBuffer())

  const document = await Documents.addDocument(db, tenantId, {
    bytes,
    filename: file.name || "upload",
    mimeType: file.type || "application/octet-stream",
    category,
  })
  return c.json({ document: toDocument(document) })
})

app.get("/documents", requireDashboardAuth, async (c) => {
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  const cursor = c.req.query("cursor") ?? undefined
  const limit = Number(c.req.query("limit") ?? DEFAULT_PAGE_SIZE)

  const { items, nextCursor } = await Documents.listDocuments(db, tenantId, {
    cursor,
    limit,
  })
  return c.json({ items: items.map(toDocument), nextCursor })
})

app.delete("/documents/:id", requireDashboardAuth, async (c) => {
  const id = c.req.param("id")
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  const ok = await Documents.deleteDocument(db, tenantId, id)
  if (!ok) {
    return c.json({ error: "document not found", retryable: false }, 404)
  }
  return c.json({ ok: true })
})

/* =========================================================================
 * Settings — the dashboard's persona/restrictions editor. Read by `/chat`
 * above on every turn; see `./settings.ts`.
 * ========================================================================= */

app.get("/settings", requireDashboardAuth, async (c) => {
  const tenantId = c.req.query("tenantId") ?? DEFAULT_TENANT
  return c.json(await getSettings(db, tenantId))
})

app.post("/settings", requireDashboardAuth, async (c) => {
  const parsed = UpdateSettingsRequestSchema.safeParse(
    await c.req.json().catch(() => null)
  )
  if (!parsed.success) {
    return c.json({ error: "invalid request body", retryable: false }, 400)
  }
  const saved = await upsertSettings(db, parsed.data.tenantId, {
    persona: parsed.data.persona,
    restrictions: parsed.data.restrictions,
  })
  return c.json(saved)
})

const port = Number(process.env.PORT ?? 8788)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`chat server → http://localhost:${info.port}  (${modelLabel(MODEL)})`)
})
