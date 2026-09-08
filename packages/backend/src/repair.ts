import {
  generateObject,
  jsonSchema,
  NoSuchToolError,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai"
import { google } from "@ai-sdk/google"

/*
 * Repairing a malformed tool call.
 *
 * The model sometimes emits arguments that do not match the tool's schema — a
 * missing required field, a string where a number belongs, a stray wrapper
 * object. Left alone that fails the turn, and the visitor sees an error for
 * something they cannot act on.
 *
 * This is worth having here more than in most applications. The schemas come
 * from a customer's page rather than from us, so they are as precise as
 * whoever wrote them; and Gemini drops JSON Schema keywords it cannot express
 * when converting to its own dialect, so the model is often working from a
 * looser contract than the author actually wrote. Both make a mismatched call
 * likelier than usual.
 *
 * The repair is one cheap structured call: hand the model its own bad
 * arguments and the schema they should have matched, and ask for them again.
 */

/** Model used for the repair itself. Cheap and fast beats capable here. */
const REPAIR_MODEL = "gemini-3.1-flash-lite"

export function repairToolCall<TOOLS extends ToolSet>(
  model: string = REPAIR_MODEL
): ToolCallRepairFunction<TOOLS> {
  return async ({ toolCall, tools, inputSchema, error }) => {
    /*
     * A name that does not exist cannot be repaired by rewriting arguments.
     * Returning null lets the SDK surface it, which is right: the model
     * invented a tool, and the fix belongs in the descriptions.
     */
    if (NoSuchToolError.isInstance(error)) return null

    const tool = tools[toolCall.toolName]
    if (!tool) return null

    try {
      const schema = await inputSchema({ toolName: toolCall.toolName })

      const { object } = await generateObject({
        model: google(model),
        instructions:
          "You fix malformed tool call arguments. You are given the arguments " +
          "a model produced and the schema they must satisfy. Return the same " +
          "intent, corrected to fit the schema. Never invent a value for " +
          "something the original did not express — if a required field is " +
          "genuinely absent, use the most conservative sensible default.",
        prompt: [
          `Tool: ${toolCall.toolName}`,
          `Description: ${tool.description ?? "(none)"}`,
          `Arguments produced: ${toolCall.input}`,
          `Why they were rejected: ${error.message}`,
        ].join("\n"),
        schema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
      })

      return { ...toolCall, input: JSON.stringify(object) }
    } catch (cause) {
      /*
       * A failed repair must not replace a bad tool call with a broken turn.
       * Null hands the original error back to the SDK, which is no worse than
       * having never tried.
       */
      console.warn(`[repair] could not fix ${toolCall.toolName}:`, cause)
      return null
    }
  }
}
