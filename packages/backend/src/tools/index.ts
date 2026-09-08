import { tool, type Tool } from "ai"
import { z } from "zod"

import { ragSearch } from "../rag"
import { EmbeddingModelMismatch } from "@workspace/rag"

/*
 * Server-side tools.
 *
 * Nearly empty, and that is the design. A tool belongs to whoever embeds the
 * widget: it hits their order system, reads their cart, knows their pricing.
 * Shipping ours would mean every customer deploying our server to change
 * their own tools, which is backwards.
 *
 * So tools arrive with the request instead — see `./client`. What is left
 * here is the seam for tools that genuinely cannot live in a browser: work
 * needing a secret we hold, or a service that will not accept a call from a
 * customer's page.
 *
 * `searchKnowledge` is the first occupant. It cannot move to the page for two
 * independent reasons: embedding the query needs the same provider key the
 * chat does, and the index it searches is hundreds of megabytes of vectors
 * that no visitor should download to ask one question.
 */

/**
 * Retrieval over the customer's ingested docs and FAQs.
 *
 * Built per request rather than defined once, so the knowledge base it may
 * read is bound at construction. That is not ceremony: one process answers for
 * every customer, and a module-level tenant would let whichever ingest ran
 * last decide whose docs the next visitor gets. Binding it here also keeps it
 * out of `inputSchema` — an input is chosen by the model, and a model that can
 * name the tenant is a model that can be talked into naming someone else's.
 *
 * The description is the entire mechanism by which this ever fires — a model
 * reaches for whichever tool description best matches the question — so it is
 * written around what visitors ask rather than what the tool does. The
 * instruction to search *before* answering also lives in the system prompt,
 * because a description alone loses to a model's confidence in what it
 * already "knows" about a well-known product.
 */
function searchKnowledge(tenantId: string): Tool {
  /*
   * Url → citation index, shared across every call this tool makes within one
   * turn. A model narrowing its search calls the tool more than once, and a
   * passage it already cited as [2] must stay [2] the second time it comes
   * back — a marker that changed meaning mid-reply would point at the wrong
   * row once the widget renders the citation list.
   */
  const citationIndex = new Map<string, number>()

  return tool({
    description:
      "Search the site's own documentation, help centre and FAQs. Use this " +
      "before answering any question about the product, pricing, plans, " +
      "policies, limits, setup or troubleshooting — including questions you " +
      "believe you already know the answer to. Returns passages each tagged " +
      "with a citation index — cite with that, not the url.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(400)
        .describe(
          "What to look for, in the visitor's own words. Keep product names " +
            "and error codes verbatim — they are matched literally as well " +
            "as semantically."
        ),
    }),
    execute: async ({ query }) => {
      let hits: Awaited<ReturnType<typeof ragSearch>>
      try {
        hits = await ragSearch(tenantId, query, 5)
      } catch (cause) {
        /*
         * An index built by a different embedding model — see `/rag/search`'s
         * handler for the full explanation. Reported to the model as data
         * rather than left to throw: an uncaught error here fails the whole
         * turn, when what actually happened is "retrieval is unavailable
         * right now", which the model can say in a sentence and move on from.
         */
        if (cause instanceof EmbeddingModelMismatch) {
          return {
            found: 0,
            note:
              "The knowledge base is temporarily unavailable (index configuration " +
              "changed). Do not answer from prior knowledge — say search is down " +
              "and offer a handoff.",
          }
        }
        throw cause
      }

      /*
       * An empty result is reported as a sentence, not as an empty array.
       *
       * A model handed `[]` falls back on what it thinks it knows, which is
       * the exact failure retrieval was added to prevent. Saying so in words,
       * and saying what to do instead, is what actually produces "that isn't
       * in the docs — want me to get a person?".
       */
      if (!hits.length) {
        return {
          found: 0,
          note:
            "Nothing in the knowledge base matched. Do not answer from prior " +
            "knowledge — say the docs do not cover it and offer a handoff.",
        }
      }

      return {
        found: hits.length,
        note:
          "Answer only from these passages. Cite each one inline right after " +
          "the sentence it supports, using its bracketed index like [1] or " +
          "[2] — never write out the url.",
        passages: hits.map((hit) => {
          // First mention of a url gets the next index; a repeat within the
          // same turn (a narrowed second search hitting the same page) keeps
          // the one it was already given.
          let index = citationIndex.get(hit.url)
          if (index === undefined) {
            index = citationIndex.size + 1
            citationIndex.set(hit.url, index)
          }
          return {
            index,
            // The heading path is sent because it is often the disambiguator:
            // "Limits" under Enterprise and under Free are different answers.
            // Capped to match MessageSourceSchema.title (packages/api/src/schema.ts)
            // — a citation the widget cannot persist is worse than a shorter one.
            section: [hit.title, ...hit.headings]
              .filter(Boolean)
              .join(" > ")
              .slice(0, 300),
            url: hit.url,
            text: hit.question
              ? `Q: ${hit.question}\nA: ${hit.text}`
              : hit.text,
          }
        }),
      }
    },
  })
}

export type ToolMeta = {
  name: string
  /** Shown wherever a developer picks tools. */
  label: string
  /** One line on what it does, for a developer rather than the model. */
  summary: string
  /** The widget it emits, when it emits one. */
  widget?: string
  /** A prompt known to trigger it. */
  example: string
  /** In the model's context unless asked otherwise. */
  defaultEnabled: boolean
}

/*
 * The registry, as constructors rather than instances.
 *
 * A server tool that needs to know which customer it is answering for cannot
 * be a singleton — see `searchKnowledge`. Holding builders keeps `TOOLS` the
 * one list of what this server offers while letting each request get its own
 * bound copy.
 */
const TOOLS: Record<string, (tenantId: string) => Tool> = { searchKnowledge }

export const TOOL_META: ToolMeta[] = [
  {
    name: "searchKnowledge",
    label: "Search knowledge base",
    summary:
      "Hybrid search over the docs and FAQs in the knowledge base. Turn it off to watch the same question answered without retrieval.",
    example: "what is your refund policy?",
    defaultEnabled: true,
  },
]

export const TOOL_NAMES = TOOL_META.map((meta) => meta.name)

const DEFAULT_TOOLS = TOOL_META.filter((meta) => meta.defaultEnabled).map(
  (meta) => meta.name
)

/**
 * Narrows the built-in registry to the tools a request asked for.
 *
 * `undefined` means the defaults; an empty array means none at all, which is
 * meaningfully different and must not fall back. Unknown names are dropped
 * rather than erroring, since a client and this server can be at different
 * versions.
 *
 * Page-defined tools do not pass through here — they are never in this map to
 * begin with, and are built per request by `clientTools`.
 *
 * `tenantId` is threaded through because the tools this builds are themselves
 * per-request. It scopes retrieval, and nothing else reads it.
 */
export function resolveTools(
  tenantId: string,
  requested?: string[]
): Record<string, Tool> {
  const allowed = new Set(requested ?? DEFAULT_TOOLS)
  return Object.fromEntries(
    Object.entries(TOOLS)
      .filter(([name]) => allowed.has(name))
      .map(([name, build]) => [name, build(tenantId)])
  )
}
