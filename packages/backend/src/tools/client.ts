import { jsonSchema, type Tool } from "ai"

import type { ClientTool } from "@workspace/api/schema"

/*
 * Tools the page owns.
 *
 * The server keeps no registry of these. A definition arrives with the
 * request, exists for that request, and is gone afterwards — which is the
 * whole point: a customer's tools live in their page, not in our deploy.
 *
 * Each is registered with a schema but deliberately *no* implementation. The
 * AI SDK treats a tool it cannot execute as a step it cannot finish: it emits
 * the call, produces no result, and ends the turn rather than erroring. The
 * unanswered call travels down the stream, the browser runs the handler, and
 * the transcript comes back with the result attached.
 */

/**
 * Builds the per-request tool map from client definitions.
 *
 * The returned tools are marked `dynamic` so their calls are flagged as such
 * on the wire, and carry no `execute` so the model's call comes back to us
 * unanswered.
 */
export function clientTools(defined?: ClientTool[]): Record<string, Tool> {
  if (!defined?.length) return {}

  return Object.fromEntries(
    defined.map((definition) => [
      definition.name,
      {
        /*
         * `dynamic` marks the tool as defined at runtime rather than compiled
         * in. The SDK's own `dynamicTool()` helper would be the obvious way to
         * build this, but its signature requires an `execute` — the one thing
         * this tool must not have — so the object is built directly.
         */
        type: "dynamic",
        description: definition.description,
        /*
         * JSON Schema, straight from the page. Note that a provider may quietly
         * drop keywords it does not support when converting to its own dialect
         * — Gemini discards `minimum`, `pattern`, `default` and others — so
         * treat what is written here as guidance to the model, never as
         * validation. The handler is where an argument is actually checked.
         */
        inputSchema: jsonSchema(
          (definition.inputSchema as Record<string, unknown> | undefined) ?? {
            type: "object",
            properties: {},
          }
        ),
      } as Tool,
    ])
  )
}
