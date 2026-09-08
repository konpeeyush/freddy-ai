/**
 * HTML in, clean markdown out.
 *
 * This is where retrieval quality is won or lost, and it is not obvious why.
 * A docs page is perhaps 15% prose and 85% chrome — nav, sidebar, breadcrumb,
 * "edit this page", footer, cookie banner. Embed the lot and every chunk on
 * the site shares the same several hundred words, so every chunk's vector
 * drifts toward the same point and the top result for any question is
 * whichever page happens to have the least prose. Stripping chrome is not
 * tidying; it is the difference between search working and not.
 *
 * Readability does the extraction because it is the same algorithm Firefox
 * Reader View uses, and it is tuned on exactly this problem. linkedom supplies
 * the DOM: jsdom pulls native dependencies and is slow to construct, and this
 * builds one document per page.
 */
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import TurndownService from "turndown"

import type { Page } from "./types"

/*
 * The DOM surface this file uses, declared structurally rather than taken from
 * the global `Document` and `Element`.
 *
 * The document here is linkedom's, not a browser's, and this package is
 * imported by a Bun server whose tsconfig has no DOM lib — depending on the
 * globals made the server's typecheck fail on a package that never touches a
 * browser. Naming the four members actually used is both honest about the
 * dependency and portable.
 */
type Node = {
  textContent: string | null
  innerHTML: string
  remove(): void
  cloneNode(deep?: boolean): Node
  querySelector(selector: string): Node | null
  querySelectorAll(selector: string): Iterable<Node>
}

type Doc = Node & { title?: string }

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
})

/*
 * Tables survive as HTML rather than being flattened.
 *
 * Turndown drops <table> to a run of bare text by default, which turns a
 * pricing matrix into an unreadable sentence — and pricing tables are among
 * the most-asked-about content on any docs site.
 */
turndown.keep(["table"])

/** Chrome Readability sometimes keeps. Removed before it gets the chance. */
const STRIP = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "form",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[aria-hidden=true]",
  ".sidebar",
  ".toc",
  ".breadcrumb",
  ".cookie",
  ".announcement",
]

async function hash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * A question/answer pair lifted from FAQ markup.
 *
 * Worth a separate path because an FAQ is already chunked — someone wrote one
 * question and one answer — and running it through prose chunking merges
 * unrelated questions into a single blob that matches none of them well.
 */
export type Faq = { question: string; answer: string }

/**
 * Pulls Q/A pairs out of the three markups FAQs actually use: schema.org
 * FAQPage JSON-LD, <details>/<summary>, and a heading followed by prose.
 *
 * JSON-LD first — it is unambiguous, and any site that cares about rich
 * results in search already publishes it.
 */
export function faqPairs(document: Doc): Faq[] {
  const out: Faq[] = []

  for (const node of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    try {
      const parsed = JSON.parse(node.textContent ?? "")
      const graph = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] ?? [])]
      for (const entry of graph) {
        if (entry?.["@type"] !== "FAQPage") continue
        for (const item of entry.mainEntity ?? []) {
          const question = String(item?.name ?? "").trim()
          const answer = String(item?.acceptedAnswer?.text ?? "").trim()
          if (question && answer) {
            out.push({ question, answer: turndown.turndown(answer) })
          }
        }
      }
    } catch {
      // Sites ship malformed JSON-LD constantly. One bad block is not a
      // reason to lose the page.
    }
  }
  if (out.length) return out

  for (const node of document.querySelectorAll("details")) {
    const question = node.querySelector("summary")?.textContent?.trim()
    if (!question) continue
    const clone = node.cloneNode(true)
    clone.querySelector("summary")?.remove()
    const answer = turndown.turndown(clone.innerHTML).trim()
    if (answer) out.push({ question, answer })
  }

  return out
}

export type Extracted =
  | { ok: true; page: Page; faqs: Faq[] }
  | { ok: false; url: string; reason: "empty" | "too-short" | "unparseable" }

/**
 * One fetched page, reduced to what is worth embedding.
 *
 * Returns a typed failure rather than throwing: an ingest that walks 200 pages
 * will hit a few that are a redirect stub or a client-rendered shell, and the
 * playground shows those as skipped so a developer can see *why* their site
 * produced twelve chunks instead of four hundred. A crawler that silently
 * stored empty strings would look like it worked.
 */
export async function extract(
  url: string,
  html: string
): Promise<Extracted> {
  let document: Doc
  try {
    ;({ document } = parseHTML(html) as unknown as { document: Doc })
  } catch {
    return { ok: false, url, reason: "unparseable" }
  }

  const faqs = faqPairs(document)

  for (const selector of STRIP) {
    for (const node of document.querySelectorAll(selector)) node.remove()
  }

  const title =
    document.querySelector("h1")?.textContent?.trim() ||
    document.title?.trim() ||
    new URL(url).pathname

  let markdown = ""
  try {
    // Readability mutates the document it is given, hence the clone — faqPairs
    // above already read what it needed, but the caller may not expect its
    // input to come back gutted.
    // Readability's own parameter type rather than the DOM global, for the
    // reason given above the `Node` declaration.
    const article = new Readability(
      document.cloneNode(true) as unknown as ConstructorParameters<
        typeof Readability
      >[0]
    ).parse()
    if (article?.content) markdown = turndown.turndown(article.content)
  } catch {
    return { ok: false, url, reason: "unparseable" }
  }

  // Readability declines short pages outright. Falling back to <main> catches
  // the API-reference pages that are mostly tables and code, which it reads as
  // "not an article" but which are exactly what people search for.
  if (!markdown.trim()) {
    const main = document.querySelector("main, article, [role=main]")
    if (main) markdown = turndown.turndown(main.innerHTML)
  }

  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim()

  if (!markdown && !faqs.length) return { ok: false, url, reason: "empty" }
  // Below this a "page" is a nav stub or a redirect notice. Storing them
  // costs an embedding each and only ever pollutes results.
  if (markdown.length < 120 && !faqs.length)
    return { ok: false, url, reason: "too-short" }

  return {
    ok: true,
    faqs,
    page: {
      url,
      title,
      markdown,
      hash: await hash(markdown + faqs.map((f) => f.question + f.answer).join("")),
      fetchedAt: Date.now(),
    },
  }
}
