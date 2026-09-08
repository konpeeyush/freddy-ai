import { useMemo, type MouseEvent } from "react"
import { marked } from "marked"
import DOMPurify from "dompurify"

import type { MessageSource } from "@workspace/api"
import { cn } from "@workspace/ui/lib/utils"

marked.setOptions({ gfm: true, breaks: true })

/**
 * A tinted pill rather than the beui `Citation` component itself: this
 * marker is built before markdown, not mounted as a component — `marked` is
 * asked to leave raw inline HTML alone, so a hand-written anchor here
 * survives the parse untouched, but that means it cannot render JSX. Kept
 * visually distinct from ordinary prose links (which this same container
 * styles blue-and-underlined) by colour and shape instead of text
 * decoration, and carries `data-citation` so both the generic link styling
 * below and the click handler can single it out.
 */
const CITATION_CLASS =
  "mx-0.5 inline-flex min-w-5 -translate-y-0.5 cursor-pointer items-center justify-center rounded-md bg-primary/12 px-1 py-0.5 text-[10px] font-semibold leading-none text-primary no-underline outline-none ring-1 ring-primary/20 transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Turns a `[n]` the model wrote — per the system prompt's citation
 * instruction — into a link to that source's row in the `Sources` list
 * below the reply. `idPrefix` must be the same value passed to `Sources` for
 * this message, since that is what owns the id the link points at.
 *
 * Grouped markers are matched too. The prompt asks for `[1]` or `[2]`, but a
 * sentence resting on two passages routinely comes back as `[1, 2]`, and
 * matching one index per bracket left that whole run as literal prose — the
 * one place a reader looks to check an answer, rendered as the thing that
 * looks least clickable. Each index in the group becomes its own pill, since
 * they point at different rows.
 *
 * A group is rewritten only when every index in it is a real source. Half a
 * marker turned into pills would leave the rest as stray digits and commas
 * with no bracket around them, which reads as a rendering fault rather than
 * as the model having cited something that does not exist.
 *
 * Applied before `marked.parse`, not after: `marked` passes inline HTML
 * through unchanged, so the anchor survives into the sanitised output. Run
 * only outside fenced code blocks — a literal `[1]` inside a snippet (an
 * array index, say) is code, not a citation.
 */
function linkCitations(
  text: string,
  sources: MessageSource[],
  idPrefix: string
): string {
  const indices = new Set(
    sources.map((source) => source.index).filter((n) => n !== undefined)
  )
  if (!indices.size) return text

  const pill = (n: number) => {
    const id = `${idPrefix}-${n}`
    return `<a href="#${id}" data-citation data-citation-id="${id}" aria-label="View citation ${n}" class="${CITATION_CLASS}">${n}</a>`
  }

  const linkOne = (segment: string) =>
    // The negative lookahead keeps this off markdown links, whose label is a
    // bracketed run followed by `(`.
    segment.replace(
      /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g,
      (match, group: string) => {
        const numbers = group.split(",").map((part) => Number(part.trim()))
        if (!numbers.every((n) => indices.has(n))) return match
        return numbers.map(pill).join("")
      }
    )

  // Fenced code blocks pass through untouched; every other segment is prose.
  return text
    .split(/(```[\s\S]*?```)/)
    .map((segment, i) => (i % 2 === 0 ? linkOne(segment) : segment))
    .join("")
}

/**
 * Renders agent messages as markdown.
 *
 * Sanitised on every render — this content comes from the backend and is
 * injected as HTML. Shared verbatim by the chatbot widget and the dashboard's
 * conversation view, so an operator sees exactly what a visitor saw.
 */
export function Markdown({
  content,
  className,
  sources,
  idPrefix,
  onCitationClick,
}: {
  content: string
  className?: string
  /** When given (with `idPrefix`), `[n]` markers link into the source list. */
  sources?: MessageSource[]
  idPrefix?: string
  /**
   * Handles a citation marker click instead of letting the `href` navigate.
   *
   * A plain `#id` anchor cannot reach a row that lives inside a collapsed
   * `Sources` accordion (nothing is there to jump to until it opens), and the
   * widget itself mounts in a shadow root, where native hash navigation
   * cannot cross the boundary to find the target at all. Called with the
   * marker's target id (`${idPrefix}-${n}`); `Sources.openAndScrollTo` is
   * built to take exactly that.
   */
  onCitationClick?: (id: string) => void
}) {
  const html = useMemo(() => {
    const marked_ =
      sources?.length && idPrefix
        ? linkCitations(content, sources, idPrefix)
        : content
    return DOMPurify.sanitize(marked.parse(marked_, { async: false }) as string)
  }, [content, sources, idPrefix])

  const handleClick = onCitationClick
    ? (event: MouseEvent<HTMLDivElement>) => {
        const marker = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-citation-id]"
        )
        if (!marker) return
        event.preventDefault()
        onCitationClick(marker.dataset.citationId as string)
      }
    : undefined

  return (
    <div
      onClick={handleClick}
      className={cn(
        "text-sm leading-relaxed",
        // Spacing between blocks, but never a leading/trailing gap.
        "[&>*]:my-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:min-w-0 [&_p]:wrap-break-word",
        "[&_strong]:font-semibold",
        // `:not([data-citation])` keeps this off the pills above — they carry
        // their own colour and are never underlined.
        "[&_a:not([data-citation])]:text-primary [&_a:not([data-citation])]:underline [&_a:not([data-citation])]:underline-offset-2",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_li]:my-1",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
        "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium",
        "[&_hr]:border-border",
        "[&_table]:w-full [&_table]:text-xs",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-start",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
