import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Wikipedia lookups.
 *
 * Real article summaries, no key, CORS open. Its job in this set is the two
 * things the other cards do not have: a remote image whose URL is not known
 * until the call returns, and a link out to somewhere else.
 *
 * A search step precedes the summary because the summary endpoint wants an
 * exact title. Asking it directly for "great barrier reef" misses; asking
 * search first and taking the top hit is what a person would do.
 */

const SEARCH = "https://en.wikipedia.org/w/rest.php/v1/search/page"
const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary"

type SearchResponse = { pages?: { key?: string; title?: string }[] }

type SummaryResponse = {
  title?: string
  description?: string
  extract?: string
  type?: string
  lang?: string
  thumbnail?: { source?: string }
  content_urls?: { desktop?: { page?: string } }
}

/** Long enough to be worth showing, short enough to fit a card. */
const MAX_EXTRACT = 420

export const lookupArticle: DevTool = {
  definition: {
    name: "lookupArticle",
    description:
      "Look up an encyclopaedia summary of a person, place, event or thing, " +
      "and show it as a card with a link to the full article. Use when " +
      "someone asks what or who something is, or for background on a topic. " +
      "Do not use it for questions about this business, its products, or " +
      "its policies — it only knows general knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look up, in a few words, e.g. 'Great Barrier Reef'",
        },
      },
      required: ["query"],
    },

    async handler(input) {
      const query = String(input.query ?? "").trim()

      try {
        const search = (await fetch(
          `${SEARCH}?q=${encodeURIComponent(query)}&limit=1`
        ).then((r) => r.json())) as SearchResponse

        const key = search.pages?.[0]?.key
        if (!key) {
          // A miss is information: the model can offer to answer directly.
          return {
            error: `I couldn't find an article about "${query}".`,
          }
        }

        const page = (await fetch(
          `${SUMMARY}/${encodeURIComponent(key)}`
        ).then((r) => r.json())) as SummaryResponse

        const extract = (page.extract ?? "").trim()
        if (!extract) {
          return { error: `The article about "${query}" had no summary.` }
        }

        /*
         * Disambiguation pages are a list of links with no content of their
         * own — rendering one as a summary card shows the visitor a paragraph
         * explaining that the term is ambiguous, which is not an answer.
         */
        if (page.type === "disambiguation") {
          return {
            error:
              `"${query}" could mean several things. Ask which one they mean.`,
          }
        }

        const title = page.title ?? key

        return widget(
          "article_summary",
          {
            title,
            description: page.description ?? "",
            extract:
              extract.length > MAX_EXTRACT
                ? `${extract.slice(0, MAX_EXTRACT).trimEnd()}…`
                : extract,
            thumbnail: page.thumbnail?.source,
            url:
              page.content_urls?.desktop?.page ??
              `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}`,
            lang: page.lang ?? "en",
          },
          {
            summary:
              `Showed a summary card for "${title}"${
                page.description ? ` — ${page.description}` : ""
              }, with a link to the full article. The visitor can read it, so ` +
              `add a line of your own rather than repeating the summary.`,
          }
        )
      } catch {
        return {
          error:
            "The encyclopaedia service didn't respond. Say so and offer to " +
            "answer from what you know instead.",
        }
      }
    },
  },

  meta: {
    name: "lookupArticle",
    label: "Encyclopaedia",
    summary: "Real Wikipedia summaries, with a thumbnail and a link out.",
    widget: "article_summary",
    example: "what is the great barrier reef?",
    defaultEnabled: true,
  },
}
