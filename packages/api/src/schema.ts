import { z } from "zod"

/**
 * The wire contract between the widget/dashboard and the backend.
 *
 * Imported by both sides on purpose: add a field here and TypeScript breaks
 * whichever half you forgot to update, which is where this kind of code
 * usually drifts.
 */

/** Namespaces a knowledge base. One customer's docs never answer another's. */
export const TenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "tenant ids are alphanumeric, dash or underscore")

/** Single-tenant today (no auth/org concept yet) — every call omitting a
 *  tenantId lands here. Kept as a real column throughout so multi-tenant
 *  support is additive later rather than a migration. */
export const DEFAULT_TENANT = "default"

export const RoleSchema = z.enum(["user", "agent"])
export type Role = z.infer<typeof RoleSchema>

/*
 * Message parts.
 *
 * A reply is no longer just a string: a tool can emit a widget, and a widget
 * has nowhere to live in prose. `parts` carries the ordered content, so a
 * reply can interleave a sentence, a card, and a follow-up sentence.
 *
 * `text` stays on the message alongside it, and stays authoritative for what
 * gets sent back to the model — the model reasons about the conversation in
 * prose, so a widget contributes its summary rather than its data.
 */

export const TextPartSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
})

export const WidgetPartSchema = z.object({
  kind: z.literal("widget"),
  /** Which widget definition renders this. */
  widgetId: z.string().min(1),
  /** Definition version the data was written against. */
  version: z.number().int().positive().default(1),
  /** Validated against the widget's own schema at render time. */
  data: z.unknown(),
  /** Prose fallback: sent to the model, and shown where rendering is off. */
  summary: z.string().optional(),
})

/*
 * Tool call and its result.
 *
 * A browser-executed tool suspends the turn: the model emits the call, the
 * stream ends, the page runs the handler, and the transcript is sent again
 * with the result attached. Both halves have to survive in history or the
 * resumed request is a dangling call — which Gemini rejects outright.
 *
 * They live in `parts` rather than a new message role because the result
 * belongs to the same turn as the call that produced it.
 */

export const ToolCallPartSchema = z.object({
  kind: z.literal("tool-call"),
  /** Correlates the call with its result. Never match on name — a tool can
   *  be called twice in one turn. */
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  /**
   * Opaque provider state belonging to this call, carried back verbatim.
   *
   * Gemini 3 signs its own tool calls and rejects a replayed call whose
   * signature was dropped — so this is not optional bookkeeping, it is part
   * of the call. Never edit it; the only correct thing to do is hand back
   * exactly what arrived.
   */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
})

export const ToolResultPartSchema = z.object({
  kind: z.literal("tool-result"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  /** Whatever the handler resolved with. A widget envelope renders; anything
   *  else is JSON the model reads. */
  output: z.unknown(),
  /** Set when the handler threw or timed out. The model is told, rather than
   *  being left with a call that never came back. */
  errorText: z.string().optional(),
})

export const MessagePartSchema = z.discriminatedUnion("kind", [
  TextPartSchema,
  WidgetPartSchema,
  ToolCallPartSchema,
  ToolResultPartSchema,
])
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>
export type ToolResultPart = z.infer<typeof ToolResultPartSchema>
export type MessagePart = z.infer<typeof MessagePartSchema>

/*
 * A document the reply drew on.
 *
 * Display-only, and deliberately kept off `parts`. A tool result in `parts`
 * is replayed to the model on the next request, and a result without its
 * matching call is a dangling pair the provider rejects — but retrieval runs
 * server-side, so the browser only ever sees the result half. These live
 * beside the parts instead: rendered, stored, never sent back.
 */
export const MessageSourceSchema = z.object({
  url: z.url(),
  /** The heading path the passage came from, when retrieval reported one. */
  title: z.string().max(300).optional(),
  /**
   * The `[n]` a tool told the model to cite this passage as, stable across
   * every call within one turn. Absent for a source a tool reported without
   * assigning one — it still shows in the list, just with no inline marker
   * pointing back to it.
   */
  index: z.number().int().positive().optional(),
})
export type MessageSource = z.infer<typeof MessageSourceSchema>

/** Beyond this the citation row stops being scannable and becomes a list. */
export const MAX_MESSAGE_SOURCES = 12

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  /**
   * Prose form of the message. Always populated — it is what the server sends
   * upstream, so a widget-only reply still carries its summary here.
   */
  text: z.string(),
  /**
   * Rich content, when there is any. Absent on a plain text message, which
   * keeps every existing message valid without a migration.
   */
  parts: z.array(MessagePartSchema).optional(),
  /**
   * What the answer was grounded in, deduplicated by url.
   *
   * Present only on replies where retrieval actually ran and returned
   * something. Absent is meaningfully different from empty: absent means the
   * question never went to the knowledge base, empty would mean it did and
   * found nothing.
   */
  sources: z.array(MessageSourceSchema).max(MAX_MESSAGE_SOURCES).optional(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

/*
 * A tool the host page defines and runs.
 *
 * `inputSchema` is JSON Schema, not Zod: this crosses the wire and is
 * authored by a customer in a plain <script> tag, where importing our Zod is
 * not an option. It is handed to the model as-is.
 *
 * Note that Gemini silently drops most JSON Schema keywords it does not
 * support (`minimum`, `pattern`, `default`, and friends) when it converts to
 * its own dialect. Constraints expressed there are documentation for the
 * model, never enforcement — validate in the handler.
 */
export const MAX_CLIENT_TOOLS = 32

export const ClientToolSchema = z.object({
  /** Must match what the model is allowed to emit as a function name. */
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "tool names must be alphanumeric, starting with a letter or underscore"
    ),
  /** What the model reads to decide whether to call it. */
  description: z.string().min(1).max(1024),
  /** JSON Schema for the arguments. Absent means a tool taking none. */
  inputSchema: z.record(z.string(), z.unknown()).optional(),
})
export type ClientTool = z.infer<typeof ClientToolSchema>

export const ChatRequestSchema = z.object({
  /**
   * Full conversation, oldest first, including the message being sent.
   * Stateless by design for this iteration — the /chat route itself keeps
   * nothing; persistence is layered on by the caller separately (see the
   * conversations/messages endpoints below).
   */
  messages: z.array(ChatMessageSchema).min(1).max(200),
  /**
   * Which tools to put in the model's context for this turn.
   *
   * Omitted means "everything enabled by default", which is what a real
   * embed sends. The dev harness passes an explicit list so a developer can
   * see how the model behaves with a tool withheld.
   *
   * Enforced on the server: a tool absent from this list is never passed
   * upstream, so the model cannot call it however it is prompted.
   */
  tools: z.array(z.string()).optional(),
  /**
   * Tools the page defined and will execute itself.
   *
   * These arrive as definitions, not names: the server has never heard of
   * them, so it registers each one for this request only, with a schema but
   * no implementation. The model can then call it, and the call comes back
   * down the stream unanswered for the browser to run.
   *
   * Untrusted — this is a public endpoint that any origin can post to. Hence
   * the caps: a definition here decides what the model is told, so it is
   * bounded in count, in name shape, and in description length.
   */
  clientTools: z.array(ClientToolSchema).max(MAX_CLIENT_TOOLS).optional(),
  /**
   * Forces a tool call rather than letting the model answer in prose.
   */
  toolChoice: z.enum(["auto", "required", "none"]).optional(),
  /**
   * Extra instruction appended to the system prompt for this turn only.
   */
  turnInstruction: z.string().max(2000).optional(),
  /**
   * Which knowledge base `searchKnowledge` may read.
   *
   * Absent means the default single-tenant namespace.
   */
  tenantId: TenantIdSchema.optional(),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

/** Errors are JSON even though success is a plain text stream. */
export const ChatErrorSchema = z.object({
  error: z.string(),
  /** Present when the failure is worth retrying (rate limits, upstream 5xx). */
  retryable: z.boolean().default(false),
})
export type ChatError = z.infer<typeof ChatErrorSchema>

/** Sent as a trailing header so the client can tell "done" from "cut off". */
export const FINISH_HEADER = "x-chat-finish"

/*
 * Widget envelope.
 *
 * A tool signals "render this, don't just narrate it" by returning a result
 * shaped like this. The marker key is what lets the client tell a widget from
 * an ordinary tool result without knowing which tools exist.
 */
export const WIDGET_ENVELOPE_KEY = "_widget"

export const WidgetEnvelopeSchema = z.object({
  [WIDGET_ENVELOPE_KEY]: z.literal(true),
  widgetId: z.string().min(1),
  version: z.number().int().positive().default(1),
  data: z.unknown(),
  /**
   * Prose the model sees in place of the data. Without it the model has no
   * idea what it just showed, and will narrate the widget badly or repeat it.
   */
  summary: z.string().optional(),
})
export type WidgetEnvelope = z.infer<typeof WidgetEnvelopeSchema>

/** Helper for tool authors: wraps data in the envelope the client expects. */
export function widget(
  widgetId: string,
  data: unknown,
  options: { summary?: string; version?: number } = {}
): WidgetEnvelope {
  return {
    [WIDGET_ENVELOPE_KEY]: true,
    widgetId,
    version: options.version ?? 1,
    data,
    summary: options.summary,
  }
}

/*
 * What the client gets out of a stream.
 *
 * The wire is the AI SDK's SSE protocol, which carries far more part types
 * than the UI needs (reasoning, step boundaries, provider metadata). The
 * client narrows that to these three: prose, a tool starting, a tool landing.
 */
export type StreamEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool-start"; id: string; tool: string; input: unknown }
  | { kind: "tool-end"; id: string; output: unknown }
  /**
   * A tool the page has to run. Emitted when the stream carries a call with
   * no result behind it, which is what a tool registered without an
   * implementation produces. The turn is suspended until the handler answers.
   */
  | {
      kind: "client-tool-call"
      id: string
      tool: string
      input: unknown
      /** Handed straight back on the resumed request. See ToolCallPartSchema. */
      providerOptions?: Record<string, unknown>
    }
  /**
   * A tool returned a widget rather than prose. Split out from `tool-end` so
   * the UI does not have to sniff every tool result for an envelope, and so
   * a widget can land mid-stream — before the model has finished its sentence.
   */
  | {
      kind: "widget"
      id: string
      widgetId: string
      version: number
      data: unknown
      summary?: string
    }

/*
 * Sequences.
 *
 * A sequence pins the order of a multi-step flow. The ordinary tool loop
 * already lets the model chain calls — it sees each result before choosing the
 * next — but "chose well four times running" is not the same guarantee as
 * "cannot do it in another order", and a flow with real side effects wants the
 * second one.
 *
 * The order is enforced by withholding tools, not by prompting. While a
 * sequence is active the request carries only the step it is on, so a later
 * step is not merely discouraged, it is absent from the model's context and
 * uncallable however the conversation goes. See `tools/sequences.ts` in the
 * widget, which is the sole runtime consumer of these types — a customer
 * registers a `Sequence` via `window.FreddyChat.registerSequence()`.
 */

/** Steps per sequence. Each one is a model round trip the visitor waits on. */
export const MAX_SEQUENCE_STEPS = 12

/*
 * A step that asks the visitor something and keeps the answer.
 *
 * Not every step is a tool. "Ask for their order number, then look it up" is
 * two steps of different kinds, and only the second is a function call. The
 * asking is done by the model in prose; what makes it a *step* is that the
 * sequence does not advance until the field has been captured.
 */
export const AskStepSchema = z.object({
  kind: z.literal("ask"),
  /**
   * Where the answer is stored, and how a later step refers to it: a step
   * writing `field: "orderNumber"` is read back as `$orderNumber`.
   */
  field: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "field names must be alphanumeric, starting with a letter or underscore"
    ),
  /** What the model should ask for, in its own words. Not a literal script. */
  prompt: z.string().min(1).max(512),
})

/** A step that calls one page-defined tool. */
export const ToolStepSchema = z.object({
  kind: z.literal("tool"),
  /** A name in the page's tool registry, resolved when the sequence is used. */
  tool: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "must be a valid tool name"),
  /**
   * Arguments taken from fields captured earlier, as `{ city: "$location" }`.
   *
   * Only what the flow pins down. Anything omitted the model fills as usual
   * from the conversation — a sequence fixes the order of steps, it does not
   * have to fix every argument of every step.
   */
  inputFrom: z.record(z.string(), z.string()).optional(),
})

export const SequenceStepSchema = z.discriminatedUnion("kind", [
  AskStepSchema,
  ToolStepSchema,
])
export type AskStep = z.infer<typeof AskStepSchema>
export type ToolStep = z.infer<typeof ToolStepSchema>
export type SequenceStep = z.infer<typeof SequenceStepSchema>

export const SequenceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "must be a valid identifier"),
  /** Shown wherever a developer picks a sequence. */
  label: z.string().min(1).max(128),
  /**
   * When to start this, phrased around what a visitor would say.
   *
   * Read by the model, and the only thing deciding whether the sequence ever
   * fires — the same job, and the same failure mode, as a tool's description.
   */
  trigger: z.string().min(1).max(1024),
  steps: z.array(SequenceStepSchema).min(1).max(MAX_SEQUENCE_STEPS),
})
export type Sequence = z.infer<typeof SequenceSchema>

/*
 * Compiling a sequence from prose.
 *
 * The author writes "when someone asks about a refund, get their order
 * number, then @lookupOrder, then @startRefund" and gets back ordered, typed
 * steps. Same bargain as `DraftToolRequestSchema` below: the model does the
 * structuring, a person edits the result.
 *
 * Dev-time only — the widget's dev playground (`apps/chatbot/dev`) is the
 * sole consumer, via the backend's `/compile-sequence`. Nothing in the
 * shipped widget bundle touches this.
 *
 * Tool references arrive as `@name` in the prose. They are inserted by a
 * picker rather than typed, so the names are real — but they are checked
 * against `availableTools` regardless, since the text is editable afterwards
 * and a tool can be unregistered between authoring and use.
 */
export const SequenceSourceSchema = z.object({
  /** The flow as written, `@tool` mentions and all. */
  source: z.string().min(3).max(4000),
  /** Tool names the mentions may resolve to. A mention outside this fails. */
  availableTools: z.array(z.string()).max(MAX_CLIENT_TOOLS).optional(),
  /** Ids already taken, so a compiled sequence does not collide. */
  existingIds: z.array(z.string()).max(64).optional(),
})
export type SequenceSource = z.infer<typeof SequenceSourceSchema>

/**
 * A compiled sequence, plus what the compiler could not settle on its own.
 *
 * `warnings` is the important half. Prose leaves real questions open — which
 * captured field feeds which argument, whether a step is required — and a
 * compiler that guesses silently produces a flow that runs in the wrong order
 * without ever looking wrong. Surfaced for the author to correct instead.
 */
export const CompiledSequenceSchema = z.object({
  sequence: SequenceSchema,
  warnings: z.array(z.string()).max(16).default([]),
})
export type CompiledSequence = z.infer<typeof CompiledSequenceSchema>

/*
 * Drafting a tool from a description.
 *
 * Writing JSON Schema by hand is the step people get wrong — and a tool whose
 * schema is subtly off fails in the least legible way possible: the model
 * either never calls it or calls it with arguments the handler cannot use.
 * So the model writes it, and a person edits what it produced.
 *
 * A dev-time affordance, like `SequenceSourceSchema` above. Nothing in the
 * widget bundle calls this outside the dev playground.
 */
export const DraftToolRequestSchema = z.object({
  /** What the tool should do, in whatever words come to mind. */
  intent: z.string().min(3).max(2000),
  /** Names already taken, so the draft does not collide with one. */
  existingNames: z.array(z.string()).max(MAX_CLIENT_TOOLS).optional(),
  /** Widget ids the result may render, when rendering makes sense. */
  widgetIds: z.array(z.string()).max(64).optional(),
})
export type DraftToolRequest = z.infer<typeof DraftToolRequestSchema>

/**
 * A drafted tool.
 *
 * Deliberately the same shape the dev playground's form holds, so the
 * response drops straight into the fields rather than needing a translation
 * step that could disagree with the form's own validation.
 */
export const DraftedToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** JSON Schema for the arguments. */
  inputSchema: z.record(z.string(), z.unknown()),
  /** What a call should hand back — realistic sample data, not a placeholder. */
  returnKind: z.enum(["json", "widget"]),
  returnValue: z.record(z.string(), z.unknown()),
  /** Set when `returnKind` is "widget". */
  widgetId: z.string().optional(),
  summary: z.string().optional(),
  /** One line on why it was drafted this way, shown to the person editing. */
  note: z.string().optional(),
})
export type DraftedTool = z.infer<typeof DraftedToolSchema>

/*
 * Retrieval.
 *
 * The knowledge base is server-side and deliberately so: ingestion holds the
 * embedding key, and the store is the one piece of state this server keeps.
 * A page-defined tool could not do this — see `tools/client.ts`.
 */

export const RagIngestRequestSchema = z.object({
  /** Where to start. A path scopes the crawl: `/docs` ingests the docs only. */
  url: z.url(),
  tenantId: TenantIdSchema.default(DEFAULT_TENANT),
  /** Bounded because each page costs an embedding call. */
  maxPages: z.number().int().min(1).max(500).default(60),
  /** Drop stored pages the crawl no longer sees. Off for a first run. */
  prune: z.boolean().default(false),
})
export type RagIngestRequest = z.infer<typeof RagIngestRequestSchema>

export const RagSearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  tenantId: TenantIdSchema.default(DEFAULT_TENANT),
  limit: z.number().int().min(1).max(20).default(5),
})
export type RagSearchRequest = z.infer<typeof RagSearchRequestSchema>

/** One retrieved chunk, as the dev harness renders it. */
export const RagHitSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  headings: z.array(z.string()),
  question: z.string().optional(),
  text: z.string(),
  tokens: z.number(),
  score: z.number(),
  /** Which retriever found it. Both means the hybrid actually agreed. */
  via: z.array(z.enum(["vector", "keyword"])),
})
export type RagHit = z.infer<typeof RagHitSchema>

export const RagSourceSchema = z.object({
  tenantId: z.string(),
  origin: z.string(),
  pages: z.number(),
  chunks: z.number(),
  lastIngestedAt: z.number(),
})
export type RagSource = z.infer<typeof RagSourceSchema>

/* =========================================================================
 * Conversations, messages, documents.
 *
 * The chat route above stays exactly what it was in the original harness:
 * stateless, trusting only the history the caller sends it. Everything below
 * is additive structure layered on top by the caller (the widget, and the
 * dashboard) so a conversation started in the widget is visible — and
 * answerable by a human — in the dashboard. None of it changes `/chat`'s
 * contract.
 * ========================================================================= */

export const ConversationStatusSchema = z.enum([
  "unresolved",
  "escalated",
  "resolved",
])
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>

/** Who actually produced an `agent`-role message: the model, or a human
 *  operator typing from the dashboard. Kept separate from `role` because the
 *  widget renders both identically (an "agent" bubble) — this is purely for
 *  the dashboard and for `/conversations/*` bookkeeping. */
export const MessageSenderSchema = z.enum(["visitor", "assistant", "operator"])
export type MessageSender = z.infer<typeof MessageSenderSchema>

/** Passively captured at first contact — never a login form. */
export const VisitorMetaSchema = z.object({
  userAgent: z.string().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  referrer: z.string().optional(),
  currentUrl: z.string().optional(),
  viewportWidth: z.number().int().positive().optional(),
  viewportHeight: z.number().int().positive().optional(),
})
export type VisitorMeta = z.infer<typeof VisitorMetaSchema>

export const StoredMessageSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  sender: MessageSenderSchema,
  text: z.string(),
  parts: z.array(MessagePartSchema).optional(),
  sources: z.array(MessageSourceSchema).max(MAX_MESSAGE_SOURCES).optional(),
  createdAt: z.number(),
})
export type StoredMessage = z.infer<typeof StoredMessageSchema>

export const ConversationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string(),
  status: ConversationStatusSchema,
  visitorName: z.string().optional(),
  visitorMeta: VisitorMetaSchema.optional(),
  lastMessagePreview: z.string().optional(),
  lastMessageAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Conversation = z.infer<typeof ConversationSchema>

/** Same shape as `ConversationSchema`, kept as its own type so the inbox list
 *  can stay independent of anything the detail view later grows. */
export const ConversationListItemSchema = ConversationSchema
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>

/**
 * Appends one message, lazily creating the conversation on first contact.
 *
 * `id` is client-generated (matches `ChatMessageSchema.id`) so a retried
 * append is idempotent — the same message posted twice upserts, not
 * duplicates.
 */
export const AppendMessageRequestSchema = z.object({
  tenantId: TenantIdSchema.default(DEFAULT_TENANT),
  message: StoredMessageSchema.omit({ createdAt: true }).extend({
    createdAt: z.number().optional(),
  }),
  /** Only meaningful (and only sent) on the very first message of a
   *  conversation — later calls updating it would overwrite nothing new. */
  visitorMeta: VisitorMetaSchema.optional(),
})
export type AppendMessageRequest = z.infer<typeof AppendMessageRequestSchema>

export const AppendMessageResponseSchema = z.object({
  ok: z.literal(true),
  conversation: ConversationSchema,
})
export type AppendMessageResponse = z.infer<typeof AppendMessageResponseSchema>

export const PollMessagesResponseSchema = z.object({
  messages: z.array(StoredMessageSchema),
  conversationStatus: ConversationStatusSchema,
})
export type PollMessagesResponse = z.infer<typeof PollMessagesResponseSchema>

/** How many rows a single list call returns; pages beyond that are fetched
 *  with `cursor`. */
export const DEFAULT_PAGE_SIZE = 20

export const ListConversationsResponseSchema = z.object({
  items: z.array(ConversationListItemSchema),
  nextCursor: z.string().optional(),
})
export type ListConversationsResponse = z.infer<
  typeof ListConversationsResponseSchema
>

export const UpdateConversationStatusRequestSchema = z.object({
  status: ConversationStatusSchema,
})
export type UpdateConversationStatusRequest = z.infer<
  typeof UpdateConversationStatusRequestSchema
>

export const DocumentStatusSchema = z.enum(["processing", "ready", "failed"])
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>

export const DocumentSourceSchema = z.enum(["upload", "crawl"])
export type DocumentSource = z.infer<typeof DocumentSourceSchema>

export const DocumentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string(),
  filename: z.string(),
  category: z.string().optional(),
  source: DocumentSourceSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatusSchema,
  error: z.string().optional(),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Document = z.infer<typeof DocumentSchema>

export const ListDocumentsResponseSchema = z.object({
  items: z.array(DocumentSchema),
  nextCursor: z.string().optional(),
})
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponseSchema>

export const UploadDocumentResponseSchema = z.object({
  document: DocumentSchema,
})
export type UploadDocumentResponse = z.infer<
  typeof UploadDocumentResponseSchema
>
