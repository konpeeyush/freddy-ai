import { useCallback, useMemo, useState, type RefObject } from "react"

import type { MessageSource } from "@workspace/api"

import type { CitationItem } from "./citations"
import { SPRING_DISCLOSURE } from "@workspace/ui/lib/ease"

/*
 * The citation data and open/scroll behaviour shared by every place a
 * message's sources show up — the standalone `Sources` block for an older
 * reply, and the compact trigger a message's action row folds into its own
 * row for the newest one. Split out from both so neither file mixes
 * components with plain exports, which breaks fast refresh.
 *
 * Not exported through this package's `components/*` map (this file has no
 * JSX, so it isn't covered by that wildcard) — consumers outside
 * `packages/ui` import these re-exported from `./sources` instead.
 */

export type SourcesHandle = {
  /** Opens the list (if closed) and scrolls the matching row into view. */
  openAndScrollTo: (id: string) => void
}

/** Domain without the `www.`, which is noise in a list of them. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/**
 * The deepest heading in a breadcrumb.
 *
 * Retrieval returns the whole path — "Generating and Streaming Text >
 * streamText > onError callback" — which is what makes the *chunk* findable
 * but reads badly in a narrow list, where truncation eats the specific end and
 * leaves three rows all starting with the same page name. The last segment is
 * the part that differs; the full path stays as the link's tooltip.
 */
function leafOf(title: string): string {
  const parts = title.split(">")
  return (parts[parts.length - 1] ?? title).trim() || title
}

/**
 * Same origin as the chat endpoint, different path.
 *
 * `baseUrl` points at the backend's chat endpoint specifically, not just its
 * host — a plain string join would leave `/chat/favicon`. `URL`'s
 * leading-slash resolution replaces the whole path instead, landing on
 * `/favicon` on the same host.
 */
function faviconUrl(baseUrl: string, domain: string): string | undefined {
  try {
    const url = new URL("/favicon", baseUrl)
    url.searchParams.set("domain", domain)
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Retrieval's `MessageSource[]` as the generic shape `Citations` expects.
 *
 * `faviconBaseUrl` is any same-origin-as-the-backend URL (the chat endpoint
 * in the widget, the backend's base URL in the dashboard) — passed in rather
 * than read from a config context, since this package has no opinion on
 * where that config lives in either caller.
 */
export function useSourceCitations(
  sources: MessageSource[],
  faviconBaseUrl?: string
): CitationItem[] {
  return useMemo(
    () =>
      sources.map((source) => {
        const domain = domainOf(source.url)
        return {
          // Matches the `[n]` a marker in the message text links to, when
          // the model was given one — see MessageSourceSchema.index.
          id: String(source.index ?? source.url),
          title: source.title ? leafOf(source.title) : domain,
          domain,
          url: source.url,
          iconUrl: faviconBaseUrl ? faviconUrl(faviconBaseUrl, domain) : undefined,
        }
      }),
    [sources, faviconBaseUrl]
  )
}

/**
 * Open state plus the scroll-to-row behaviour an inline `[n]` marker drives.
 *
 * `rootRef` is the caller's, not created here: the element it needs to be
 * attached to (something that wraps both the trigger and the eventual list)
 * differs between the standalone `Sources` block and the row a message's
 * action bar builds, and only the caller knows which.
 */
export function useCitationsDisclosure(rootRef: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((current) => !current), [])

  /**
   * Brings a just-opened list into view, for `onAnimationComplete`.
   *
   * The trigger sits at the very bottom of a reply, so opening one near the
   * end of the transcript grows the list straight past the bottom of the
   * viewport: the chevron flips and nothing else appears to happen. Waiting
   * for the disclosure's own animation rather than guessing at a delay is
   * what makes this land on the finished height instead of a partial one, and
   * `block: "nearest"` means a list already fully visible is left alone.
   */
  const revealIntoView = useCallback(() => {
    if (!open) return
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [open, rootRef])

  const openAndScrollTo = useCallback(
    (id: string) => {
      /*
       * `getRootNode` rather than `document`: the widget mounts in a shadow
       * root, and native id lookups do not cross that boundary. `ShadowRoot`
       * implements the same `getElementById`, so this works whether the
       * caller is shadowed (the widget) or not (the dashboard).
       */
      const scrollToRow = () => {
        const root = rootRef.current?.getRootNode() as
          | Document
          | ShadowRoot
          | undefined
        root?.getElementById?.(id)?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        })
      }

      setOpen((current) => {
        if (current) {
          // Already visible — still a frame out, in case a row just changed.
          requestAnimationFrame(scrollToRow)
          return current
        }
        /*
         * Just past the disclosure's own opening, so the row has the height
         * `scrollIntoView` needs rather than the zero it grows from. Derived
         * from the spring rather than written as a number, because the two
         * silently drifting apart is how this ends up scrolling to a row
         * that is still only a few pixels tall.
         */
        window.setTimeout(scrollToRow, SPRING_DISCLOSURE.duration * 1000 + 40)
        return true
      })
    },
    [rootRef]
  )

  return { open, setOpen, toggle, revealIntoView, openAndScrollTo }
}
