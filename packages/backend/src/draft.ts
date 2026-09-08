import { generateObject } from "ai"

import { chatModel } from "./model"
import { z } from "zod"

/*
 * Drafting a tool from a sentence.
 *
 * The hard part of defining a tool is not the idea, it is the JSON Schema and
 * the description — one is fiddly to write by hand, and the other decides
 * whether the tool ever fires, in ways that are not obvious until it doesn't.
 * Both are things a model is good at and a person is slow at.
 *
 * `generateObject` rather than `generateText`: a drafted tool that does not
 * parse is worse than no draft at all, because the failure surfaces as a
 * broken form rather than an error. Constraining the shape upstream means the
 * response either conforms or the call fails cleanly.
 */

/*
 * The shape the model fills in.
 *
 * `inputSchema` is deliberately typed loose here. Nesting a JSON Schema inside
 * a schema the provider must itself honour is where this gets brittle —
 * Gemini converts to a restricted dialect and drops keywords it does not
 * recognise — so it is taken as free-form JSON and validated after.
 */
const DraftSchema = z.object({
  name: z
    .string()
    .describe(
      "camelCase function name, e.g. getOrderStatus. Letters and digits only, " +
        "starting with a letter. A verb phrase, not a noun."
    ),
  description: z
    .string()
    .describe(
      "Two or three sentences telling the model WHEN to call this, phrased " +
        "around what a visitor might say. Name the intents that should " +
        "trigger it. If a required argument might be missing, say to ask for " +
        "it rather than guess. This decides whether the tool ever fires."
    ),
  inputSchema: z
    .string()
    .describe(
      "A JSON Schema object, as a JSON string. Must be " +
        '{"type":"object","properties":{...}} with a "required" array when ' +
        "arguments are mandatory. Give every property a description written " +
        "for the model. Prefer no arguments over speculative ones."
    ),
  returnKind: z
    .enum(["json", "widget"])
    .describe(
      "Use 'widget' when the answer is something a visitor should see laid " +
        "out — a card, a list of options, a form. Use 'json' when the model " +
        "should narrate the answer in prose."
    ),
  returnValue: z
    .string()
    .describe(
      "A JSON object, as a JSON string: realistic sample data this tool " +
        "would return. Real-looking values, never placeholders like 'string'."
    ),
  widgetId: z
    .string()
    .optional()
    .describe("Required when returnKind is 'widget'. One of the offered ids."),
  summary: z
    .string()
    .optional()
    .describe(
      "Required when returnKind is 'widget'. One sentence, past tense, " +
        "saying what the visitor was shown — the model reads this instead of " +
        "the widget's data, so it knows not to repeat the card in prose."
    ),
  note: z
    .string()
    .optional()
    .describe("One short line on a judgement call worth flagging. Optional."),
})

const SYSTEM = `You design tools for an AI customer-support widget.

A tool is a function the model can call mid-conversation. You are given a
rough intent and you return a complete, well-formed definition.

What makes a tool work:

- The DESCRIPTION is the only thing the model reads when deciding to call it.
  Write it around what a visitor would say, not what the function does
  internally. "Use when someone asks where their order is, about a delivery,
  or for a tracking number" beats "Fetches order status."
- Tools compete. If a description overlaps another tool's, neither fires
  reliably. Be specific about what this one covers and what it does not.
- Ask, don't guess. If a required argument might be missing from what the
  visitor said, the description must say to ask for it.
- Arguments should be the minimum that does the job. A speculative parameter
  the model has to invent a value for is worse than no parameter.
- Every property needs a description written for the model, with an example
  where the format is not obvious.`

export type DraftInput = {
  intent: string
  existingNames?: string[]
  widgetIds?: string[]
}

export type DraftResult = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  returnKind: "json" | "widget"
  returnValue: Record<string, unknown>
  widgetId?: string
  summary?: string
  note?: string
}

/** Parses a JSON string the model produced, or throws with a usable message. */
function parseObject(text: string, field: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`the model returned unparseable JSON for ${field}`)
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`the model returned a non-object for ${field}`)
  }
  return value as Record<string, unknown>
}

/**
 * Drafts a tool definition from a plain-language intent.
 *
 * Throws on a malformed draft rather than returning a partial one — a form
 * half-filled with nonsense is harder to fix than an empty one.
 */
export async function draftTool(
  model: string,
  { intent, existingNames = [], widgetIds = [] }: DraftInput
): Promise<DraftResult> {
  const context = [
    `Intent: ${intent}`,
    existingNames.length
      ? `\nTools that already exist — do not duplicate their coverage, and ` +
        `pick a different name: ${existingNames.join(", ")}`
      : "",
    widgetIds.length
      ? `\nWidgets available to render: ${widgetIds.join(", ")}. Use one only ` +
        `if it genuinely suits the answer; otherwise return json.`
      : `\nNo widgets are available. Always return json.`,
  ].join("")

  const { object } = await generateObject({
    model: chatModel(model),
    instructions: SYSTEM,
    prompt: context,
    schema: DraftSchema,
  })

  const inputSchema = parseObject(object.inputSchema, "the arguments schema")
  if (inputSchema.type !== "object") {
    // Providers expect a top-level object for function parameters.
    throw new Error("the model returned an arguments schema that is not an object")
  }

  const isWidget =
    object.returnKind === "widget" &&
    Boolean(object.widgetId) &&
    widgetIds.includes(object.widgetId as string)

  return {
    name: object.name,
    description: object.description,
    inputSchema,
    // Downgraded rather than rejected: a widget the page cannot render would
    // fail at registration, and the rest of the draft is still useful.
    returnKind: isWidget ? "widget" : "json",
    returnValue: parseObject(object.returnValue, "the sample result"),
    widgetId: isWidget ? object.widgetId : undefined,
    summary: isWidget ? object.summary : undefined,
    note: object.note,
  }
}
