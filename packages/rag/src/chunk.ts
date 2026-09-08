/**
 * Splitting a page into retrievable pieces.
 *
 * Two rules carry most of the weight here, and both are counterintuitive.
 *
 * The first: split on headings, not on a character count. A fixed-size window
 * cuts mid-explanation, so the sentence answering the question ends up in one
 * chunk and the sentence saying what it is about ends up in another, and
 * neither retrieves. Headings are where a human already decided one idea ends.
 *
 * The second: every chunk carries its heading path. "You have 30 days from
 * delivery" embeds to something close to meaningless on its own — it could be
 * about returns, trials, or disputes. "Billing > Refunds > You have 30 days
 * from delivery" embeds near the question someone actually types. This one
 * line of prefixing moves recall more than any model swap.
 */
import type { Chunk, Page } from "./types"
import type { Faq as FaqPair } from "./extract"

/**
 * Rough token count: English averages ~4 characters per token, and code and
 * markdown run denser. Exact counting would mean shipping a tokenizer to size
 * a chunk we then embed anyway — the estimate is only ever used to decide
 * where to split, where being 15% out costs nothing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export type ChunkOptions = {
  /** Target size. Large enough to hold a whole explanation, small enough that
   *  five of them fit in a support reply's context without crowding it out. */
  targetTokens: number
  /** A section shorter than this is merged into the next one — a lone "## See
   *  also" with two links is not a retrievable idea. */
  minTokens: number
  /** Carried from the end of the previous chunk, so a thought split across a
   *  boundary is still findable from either side. */
  overlapTokens: number
  /**
   * Hard ceiling, enforced by splitting mid-block when nothing else will.
   *
   * `targetTokens` is a preference — it only ever splits *between* paragraphs,
   * so one enormous table or code fence sails past it intact. That is a
   * problem twice over: embedding models have a fixed context (nomic-embed's
   * is 2048 tokens, and it rejects the request rather than truncating), and a
   * chunk that large is poor retrieval anyway, matching everything vaguely and
   * crowding out the rest of the answer's context.
   */
  maxTokens: number
}

export const DEFAULT_CHUNKING: ChunkOptions = {
  targetTokens: 700,
  minTokens: 40,
  overlapTokens: 70,
  /*
   * Well under nomic-embed's 2048, because `estimateTokens` is a
   * characters-over-four approximation and markdown full of code or CJK runs
   * denser than that. The headroom absorbs the error.
   */
  maxTokens: 900,
}

type Section = { headings: string[]; body: string }

/**
 * A heading reduced to the words in it.
 *
 * Docs generators give nearly every heading a self-link, which turndown
 * faithfully renders as `[\`streamText\`](#streamtext)` — so the breadcrumb
 * became a URL fragment repeated inside a code span. That matters more than it
 * looks: the breadcrumb is prepended to every chunk before embedding, so the
 * punctuation and the duplicated slug were being embedded on every single
 * chunk of every page, and shown to the reader in the results list.
 */
function cleanHeading(text: string): string {
  return text
    // [label](href) → label, including the image form ![alt](src).
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Bare autolinks and leftover emphasis or code markers.
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Walks the markdown and groups lines under their heading path.
 *
 * Fenced code is tracked because `#` is a comment in half the languages a docs
 * site shows. Without the fence check, a shell snippet full of `# install the
 * CLI` shreds the page into dozens of one-line sections.
 */
function sections(markdown: string): Section[] {
  const out: Section[] = []
  const path: string[] = []
  let buffer: string[] = []
  let fenced = false

  const flush = () => {
    const body = buffer.join("\n").trim()
    if (body) out.push({ headings: [...path], body })
    buffer = []
  }

  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const heading = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const depth = heading[1]!.length
      path.length = Math.min(path.length, depth - 1)
      path[depth - 1] = cleanHeading(heading[2]!)
      // A skipped level (h2 straight to h4) leaves a hole. Filtering keeps the
      // breadcrumb readable rather than rendering "Billing >  > Refunds".
      for (let i = 0; i < path.length; i++) path[i] ??= ""
      continue
    }
    buffer.push(line)
  }
  flush()
  return out.map((s) => ({ ...s, headings: s.headings.filter(Boolean) }))
}

/**
 * Last-resort split for a single block that is over the ceiling on its own.
 *
 * Line boundaries first, since a giant block is nearly always a table or a
 * code listing and a row or a statement is the natural seam. A single line
 * still too long — a minified sample, one enormous paragraph — is cut by
 * character count, which is ugly but strictly better than a request the
 * embedding model refuses outright.
 */
function hardSplit(block: string, maxTokens: number): string[] {
  if (estimateTokens(block) <= maxTokens) return [block]

  const out: string[] = []
  let buffer = ""
  for (const line of block.split("\n")) {
    if (estimateTokens(line) > maxTokens) {
      if (buffer) {
        out.push(buffer)
        buffer = ""
      }
      const size = maxTokens * 4
      for (let i = 0; i < line.length; i += size) {
        out.push(line.slice(i, i + size))
      }
      continue
    }
    const candidate = buffer ? `${buffer}\n${line}` : line
    if (estimateTokens(candidate) > maxTokens && buffer) {
      out.push(buffer)
      buffer = line
    } else {
      buffer = candidate
    }
  }
  if (buffer) out.push(buffer)
  return out
}

/** Splits an over-long section on paragraph boundaries, never mid-fence. */
function paragraphs(body: string, options: ChunkOptions): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fenced = false

  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    // A blank line outside a fence is a real boundary; inside one it is just
    // blank space in a code sample.
    if (!fenced && line.trim() === "" && current.length) {
      blocks.push(current.join("\n"))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join("\n"))

  const out: string[] = []
  let buffer = ""
  // Oversized blocks are broken up before the packing loop, so what follows
  // only ever has to decide where to *group*, never where to cut.
  for (const block of blocks.flatMap((b) => hardSplit(b, options.maxTokens))) {
    const candidate = buffer ? `${buffer}\n\n${block}` : block
    if (estimateTokens(candidate) > options.targetTokens && buffer) {
      out.push(buffer)
      // Overlap is taken from the tail of what we just emitted, so a
      // definition at the end of one chunk still appears at the head of the
      // next and can be retrieved from either.
      const tail = buffer.slice(-options.overlapTokens * 4)
      buffer = `${tail.slice(tail.indexOf("\n") + 1)}\n\n${block}`.trim()
    } else {
      buffer = candidate
    }
  }
  if (buffer.trim()) out.push(buffer)
  // Overlap prepends a tail to the next chunk, which can push a chunk that was
  // exactly at target back over the ceiling. Clamped here so nothing leaves
  // this function above `maxTokens` whatever route it took.
  return out.flatMap((chunk) => hardSplit(chunk, options.maxTokens))
}

/**
 * A chunk's identity: its page, plus its position on that page.
 *
 * Deterministic on purpose. An earlier version used a module-level counter,
 * which made an id depend on how many chunks the process happened to have
 * produced before it — so re-ingesting the same unchanged page in a fresh
 * process produced different ids for identical content. Position is stable
 * across runs, which is what makes `upsertPage` a genuine upsert.
 *
 * Not globally unique, and deliberately not: two namespaces may index the same
 * site, and they are kept apart by `tenant_id` in the store rather than by
 * smuggling a tenant into the id of something that does not belong to one.
 */
function id(url: string, position: number): string {
  return `${url}#${position}`
}

/**
 * The text that actually gets embedded.
 *
 * Note this is *not* what is shown back to the model — `text` is. The
 * breadcrumb is a retrieval aid; repeating it in the answer context would just
 * spend tokens telling the model something the citation already says.
 */
export function embeddable(chunk: Chunk): string {
  const crumb = [chunk.title, ...chunk.headings].filter(Boolean).join(" > ")
  return chunk.question
    ? `${crumb}\nQ: ${chunk.question}\nA: ${chunk.text}`
    : `${crumb}\n\n${chunk.text}`
}

export function chunkPage(
  page: Page,
  faqs: FaqPair[] = [],
  options: ChunkOptions = DEFAULT_CHUNKING
): Chunk[] {
  const out: Chunk[] = []

  /*
   * One chunk per FAQ question, always — never merged with a neighbour even
   * when it is short. Two adjacent questions are two different things people
   * ask, and a chunk holding both matches each of them worse than a chunk
   * holding one.
   */
  for (const faq of faqs) {
    out.push({
      id: id(page.url, out.length),
      url: page.url,
      title: page.title,
      headings: ["FAQ"],
      question: faq.question,
      text: faq.answer,
      tokens: estimateTokens(faq.answer),
    })
  }

  const emit = (section: Section) => {
    for (const text of paragraphs(section.body, options)) {
      out.push({
        id: id(page.url, out.length),
        url: page.url,
        title: page.title,
        headings: section.headings,
        text,
        tokens: estimateTokens(text),
      })
    }
  }

  let pending: Section | null = null
  for (const section of sections(page.markdown)) {
    /*
     * A runt is merged into the section that follows it, and takes *that*
     * section's heading path rather than its own.
     *
     * The direction matters. A page's untitled preamble ("This page explains
     * how billing works") is a runt, and merging it forward while keeping its
     * own empty path produced a chunk holding the Refunds section under no
     * heading at all — losing the breadcrumb for the one section people search
     * for. The trailing text belongs to the heading it sits under; the
     * preamble is what is being absorbed.
     */
    const merged: Section = pending
      ? { headings: section.headings, body: `${pending.body}\n\n${section.body}` }
      : section
    pending = null

    if (estimateTokens(merged.body) < options.minTokens) {
      pending = merged
      continue
    }

    emit(merged)
  }

  /*
   * A trailing runt is emitted rather than dropped.
   *
   * `minTokens` is a preference for not storing scraps, not a licence to lose
   * the last section of every page — and the last section is disproportionately
   * often the one that matters, since "Troubleshooting" and "Limits" tend to
   * sit at the bottom. Short and findable beats absent.
   */
  if (pending) emit(pending)

  return out
}
