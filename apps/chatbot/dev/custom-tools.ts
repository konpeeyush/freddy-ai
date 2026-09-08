import { widget } from "@workspace/api"

import type { ToolDefinition } from "../src/tools/registry"
import type { DevTool } from "./tools/types"

/*
 * Tools you write in the playground.
 *
 * The point is to test the two things that actually decide whether a tool
 * works: whether the *description* makes the model reach for it, and whether
 * the *schema* makes it pass sensible arguments. Neither needs a real
 * implementation — so the handler returns something you typed, and echoes
 * back the arguments it received so you can see what the model sent.
 *
 * No `eval` anywhere. A canned return is not a limitation here: a handler
 * that fetches would be testing your API, and this is for testing the model.
 */

const STORAGE_KEY = "widget-playground-custom"

/** What the handler answers with. */
export type ReturnKind = "json" | "widget"

/** A tool as the form holds it — strings, because that is what inputs give. */
export type CustomToolDraft = {
  name: string
  description: string
  /** JSON Schema for the arguments, as typed. */
  schemaText: string
  returnKind: ReturnKind
  /** The result body: plain JSON, or the `data` for a widget. */
  returnText: string
  /** Which widget renders it, when `returnKind` is "widget". */
  widgetId: string
  /** Prose the model reads in place of widget data. */
  summary: string
}

export const EMPTY_DRAFT: CustomToolDraft = {
  name: "",
  description: "",
  schemaText: '{\n  "type": "object",\n  "properties": {}\n}',
  returnKind: "json",
  returnText: '{\n  "ok": true\n}',
  widgetId: "weather_card",
  summary: "",
}

/** Widgets a custom tool can render, for the picker. */
export const WIDGET_IDS = [
  "weather_card",
  "exchange_rate",
  "crypto_price",
  "article_summary",
]

/*
 * Validation.
 *
 * Reported per field rather than as one message: a tool has four things that
 * can be wrong at once, and being told about them one reload at a time is
 * the slow way to find out.
 */
export type DraftErrors = Partial<Record<keyof CustomToolDraft, string>>

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function parseJson(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "invalid JSON" }
  }
}

export function validate(
  draft: CustomToolDraft,
  taken: string[] = []
): DraftErrors {
  const errors: DraftErrors = {}

  if (!draft.name.trim()) {
    errors.name = "Required."
  } else if (!NAME_PATTERN.test(draft.name.trim())) {
    errors.name =
      "Letters, digits and underscores only, starting with a letter or underscore."
  } else if (taken.includes(draft.name.trim())) {
    errors.name = "A tool with that name already exists."
  }

  if (!draft.description.trim()) {
    // The single most common reason a tool never fires.
    errors.description = "Required — this is what the model reads to decide."
  } else if (draft.description.trim().length < 15) {
    errors.description = "Too short to distinguish it from another tool."
  }

  const schema = parseJson(draft.schemaText)
  if (schema.error) {
    errors.schemaText = schema.error
  } else if (
    !schema.value ||
    typeof schema.value !== "object" ||
    Array.isArray(schema.value)
  ) {
    errors.schemaText = "Must be a JSON Schema object."
  } else if ((schema.value as { type?: string }).type !== "object") {
    // Providers expect a top-level object for function parameters.
    errors.schemaText = `Top-level "type" must be "object".`
  }

  const body = parseJson(draft.returnText)
  if (body.error) errors.returnText = body.error

  if (draft.returnKind === "widget") {
    if (!draft.widgetId) errors.widgetId = "Pick a widget."
    if (!draft.summary.trim()) {
      /*
       * Without it the model has no idea what it just showed, and will either
       * narrate the card badly or repeat it in prose.
       */
      errors.summary = "Required — the model sees this instead of the data."
    }
  }

  return errors
}

export function isValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0
}

/**
 * Turns a validated draft into a registrable tool.
 *
 * The handler echoes the arguments it received alongside the canned body. That
 * echo is most of the value: it is how you see that "order 10432" became
 * `{ reference: "10432" }` and not `{ reference: "#10432" }`.
 */
export function toDefinition(draft: CustomToolDraft): ToolDefinition {
  const name = draft.name.trim()
  const inputSchema = JSON.parse(draft.schemaText) as Record<string, unknown>
  const body = JSON.parse(draft.returnText) as unknown

  return {
    name,
    description: draft.description.trim(),
    inputSchema,
    handler(input) {
      const received = Object.keys(input ?? {}).length > 0 ? input : undefined

      if (draft.returnKind === "widget") {
        return widget(draft.widgetId, body, { summary: draft.summary.trim() })
      }

      /*
       * Merged rather than nested when the body is an object, so the model
       * reads a flat result. `_receivedArguments` is namespaced to make it
       * obvious in the transcript that the playground added it.
       */
      if (body && typeof body === "object" && !Array.isArray(body)) {
        return received
          ? { ...(body as object), _receivedArguments: received }
          : body
      }
      return received ? { result: body, _receivedArguments: received } : body
    },
  }
}

/** Playground metadata for a custom tool, so it renders like the stock ones. */
export function toDevTool(draft: CustomToolDraft): DevTool {
  return {
    definition: toDefinition(draft),
    meta: {
      name: draft.name.trim(),
      label: draft.name.trim(),
      summary: draft.description.trim(),
      widget: draft.returnKind === "widget" ? draft.widgetId : undefined,
      // There is no known-good prompt for a tool that did not exist a minute
      // ago, so the chip offers the description to paraphrase instead.
      example: draft.description.trim(),
      defaultEnabled: true,
    },
  }
}

/*
 * Persistence.
 *
 * Drafts rather than built tools: a definition holds a function, which does
 * not survive JSON. Rebuilding from the draft on load also means a tool saved
 * by an older version cannot resurrect stale behaviour.
 */

export function loadDrafts(): CustomToolDraft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (entry): entry is CustomToolDraft =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as CustomToolDraft).name === "string" &&
        // Anything that no longer validates is dropped rather than shown
        // broken — the format may have changed since it was saved.
        isValid(validate(entry as CustomToolDraft))
    )
  } catch {
    // A corrupt entry is not worth failing the page over.
    return []
  }
}

export function saveDrafts(drafts: CustomToolDraft[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Private browsing. They still work for this session.
  }
}
