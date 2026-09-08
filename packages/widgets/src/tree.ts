import { z } from "zod"

/*
 * The node tree — the wire format for a widget's layout.
 *
 * Authors write JSX in the dashboard; the dashboard compiles it to this and
 * stores the result. The runtime only ever sees JSON: there is no parser and
 * no evaluator here, which is the whole reason this is safe to render inside
 * a customer's page.
 *
 * A prop is either a literal or a `$bind` object. That single distinction is
 * the entire binding surface — everything dynamic is a path lookup against
 * data that has already been validated against the widget's own schema.
 */

// ── URL safety ────────────────────────────────────────────────────────────
// Widget data can be AI-authored from knowledge-base content, so every URL is
// untrusted input. Carried over from the existing component library.

const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"])

/**
 * Control characters are rejected before scheme parsing: browsers strip
 * tab/newline/CR from a URL first, so `jav\tascript:` would otherwise slip
 * past a naive scheme check.
 */
export function isSafeUrl(value: string): boolean {
  const url = value.trim()
  if (url.length === 0) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(url)) return false
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)
  if (!scheme) return true // relative: /path, ./x, #hash, ?q
  return SAFE_URL_SCHEMES.has(scheme[0].toLowerCase())
}

// ── Bindings ──────────────────────────────────────────────────────────────

/**
 * A path into the widget's data.
 *
 * `$.` reads from the root; `$item.` / `$index` read from the nearest
 * enclosing `repeat`. Dots and numeric indices only — no function calls, no
 * arithmetic, nothing to parse beyond splitting on ".".
 */
export const BindPathSchema = z
  .string()
  .regex(
    /^\$(\.|item\.|item$|index$)[A-Za-z0-9_.[\]]*$/,
    "path must start with $. , $item. or $index"
  )

/** Value formatters. Locale-aware, applied after the path resolves. */
export const FormatSchema = z.enum([
  "money",
  "date",
  "time",
  "datetime",
  "number",
  "relative-time",
])
export type Format = z.infer<typeof FormatSchema>

export const BindSchema = z.object({
  $bind: BindPathSchema,
  /** Used when the path resolves to null/undefined — covers `?? ''`. */
  fallback: z.unknown().optional(),
  format: FormatSchema.optional(),
})
export type Bind = z.infer<typeof BindSchema>

export function isBind(value: unknown): value is Bind {
  return (
    typeof value === "object" &&
    value !== null &&
    "$bind" in value &&
    typeof (value as Bind).$bind === "string"
  )
}

// ── Conditions ────────────────────────────────────────────────────────────

/**
 * `when` gates a node. Deliberately not an expression language: a path, and
 * one of three tests against it. Anything more complex belongs in the widget
 * schema, computed by whoever produced the data.
 */
export const ConditionSchema = z.object({
  $bind: BindPathSchema,
  /** Equality test. Omit both `is` and `oneOf` for a truthiness test. */
  is: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  oneOf: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Inverts whichever test above applies. */
  not: z.boolean().optional(),
})
export type Condition = z.infer<typeof ConditionSchema>

// ── Repeat ────────────────────────────────────────────────────────────────

/** Replaces `.map()`. Binds `$item` and `$index` inside the subtree. */
export const RepeatSchema = z.object({
  over: BindPathSchema,
  /** Name bound in the subtree. Only "item" is supported today. */
  as: z.literal("item").default("item"),
  /** Path (relative to the item) for the React key. Falls back to index. */
  key: BindPathSchema.optional(),
  /** Guards against a model returning a huge array. */
  limit: z.number().int().positive().max(100).optional(),
})
export type Repeat = z.infer<typeof RepeatSchema>

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * What a Button (or Form submit) does.
 *
 *   emit   — dispatch to host-page listeners; with no listener the click
 *            becomes a visitor message and the AI handles it
 *   link   — navigate
 *   submit — gather the enclosing Form, validate, then emit
 *   close  — dismiss the widget
 */
export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("emit"),
    /** The registered function this click invokes. */
    functionName: z.string().min(1),
    /** Merged into the payload. Values may themselves be `$bind` objects. */
    additionalInputs: z.record(z.string(), z.unknown()).optional(),
    /** Which surface shows pending while the host acknowledges. */
    loadingBehavior: z.enum(["self", "widget", "none"]).default("self"),
  }),
  z.object({
    kind: z.literal("link"),
    url: z.union([z.string(), BindSchema]),
    newTab: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("submit"),
    functionName: z.string().min(1),
    additionalInputs: z.record(z.string(), z.unknown()).optional(),
    loadingBehavior: z.enum(["self", "widget", "none"]).default("self"),
  }),
  z.object({ kind: z.literal("close") }),
])
export type Action = z.infer<typeof ActionSchema>

// ── The node ──────────────────────────────────────────────────────────────

/**
 * The set of renderable types. Closed on purpose: an author cannot introduce
 * a new primitive, which is what keeps a tree renderable on every surface
 * (web widget, dashboard preview, mobile) rather than only where React runs.
 */
export const NODE_TYPES = [
  // layout
  "Box",
  "Row",
  "Col",
  "Card",
  "Divider",
  "Spacer",
  // content
  "Title",
  "Text",
  "Caption",
  "Image",
  "Icon",
  "Badge",
  "Rating",
  "Progress",
  // interactive
  "Button",
  "Input",
  "Select",
  "Checkbox",
  "RadioGroup",
  "Form",
  // structural
  "ListView",
  "ListViewItem",
  "Carousel",
  "Chart",
] as const

export type NodeType = (typeof NODE_TYPES)[number]

export type WidgetNode = {
  type: NodeType
  /** Literals or `{ $bind }` objects. Validated per-primitive at render. */
  props?: Record<string, unknown>
  children?: WidgetNode[]
  repeat?: Repeat
  when?: Condition
}

/**
 * Recursive, so it needs the getter form. `props` stays `unknown` here — each
 * primitive validates its own props at render time, which keeps one bad prop
 * from failing the whole tree.
 */
export const WidgetNodeSchema: z.ZodType<WidgetNode> = z.lazy(() =>
  z.object({
    type: z.enum(NODE_TYPES),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(WidgetNodeSchema).optional(),
    repeat: RepeatSchema.optional(),
    when: ConditionSchema.optional(),
  })
)

// ── The widget definition ─────────────────────────────────────────────────

/**
 * Picks which named state renders. Reading from data (rather than from a
 * server response) is what makes a widget reconstructible: reopening a
 * conversation replays the tree against stored data and lands on the same
 * state.
 */
export const StateBySchema = z.object({
  $bind: BindPathSchema,
  /** Resolved value, stringified, looked up here. `default` catches the rest. */
  map: z.record(z.string(), z.string()),
})

export const WidgetDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().default(1),
  /** Dashboard toggle. Gates rendering and tool exposure alike. */
  enabled: z.boolean().default(true),
  /** Shown to the author and to the model; not rendered. */
  name: z.string().min(1),
  description: z.string().optional(),
  /** JSON Schema, compiled from the author's Zod. Becomes the tool's params. */
  schema: z.record(z.string(), z.unknown()).optional(),
  stateBy: StateBySchema.optional(),
  /** Named states. A single-state widget uses the key "default". */
  states: z.record(z.string(), WidgetNodeSchema),
})
export type WidgetDefinition = z.infer<typeof WidgetDefinitionSchema>

// ── The message part ──────────────────────────────────────────────────────

/** What lands on a message when a tool emits a widget. */
export const WidgetPayloadSchema = z.object({
  widgetId: z.string().min(1),
  /** Definition version this data was written against. */
  version: z.number().int().positive().default(1),
  data: z.unknown(),
  /** Fallback text for surfaces that cannot render, and for disabled widgets. */
  summary: z.string().optional(),
})
export type WidgetPayload = z.infer<typeof WidgetPayloadSchema>

/** Tool results carry this marker so `tool-end` can recognise a widget. */
export const WIDGET_ENVELOPE_KEY = "_widget"

export function isWidgetEnvelope(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    WIDGET_ENVELOPE_KEY in (value as Record<string, unknown>)
  )
}
