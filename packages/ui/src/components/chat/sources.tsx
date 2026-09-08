import { forwardRef, useImperativeHandle, useRef } from "react"

import type { MessageSource } from "@workspace/api"

import { Citations } from "./citations"
import {
  useCitationsDisclosure,
  useSourceCitations,
  type SourcesHandle,
} from "./citations-state"

export type { SourcesHandle }
export { useCitationsDisclosure, useSourceCitations }

/*
 * What the reply still arriving is grounded in, on its own line.
 *
 * Every *committed* reply shows its sources inside the message's action row
 * instead, sharing it with copy and the thumbs. The in-flight one has no such
 * row — actions against a half-written answer are offered only once it
 * settles — so mid-stream the labelled `Citations` pill stands alone. Which
 * is the point of showing it at all: retrieval finishes long before the
 * sentence built on it does.
 *
 * `idPrefix` must match whatever `Markdown` used to render this same
 * message's inline `[n]` markers — those are anchors pointing at
 * `#${idPrefix}-${n}`, and this is what has to own the id `n` lands on.
 */
export const Sources = forwardRef<
  SourcesHandle,
  {
    sources: MessageSource[]
    idPrefix?: string
    /** Same-origin-as-the-backend URL used to proxy citation favicons —
     *  the widget's `apiUrl`, the dashboard's backend base URL. Omit to skip
     *  favicons entirely (a coloured initial is shown instead). */
    faviconBaseUrl?: string
  }
>(function Sources({ sources, idPrefix, faviconBaseUrl }, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const citations = useSourceCitations(sources, faviconBaseUrl)
  const { open, setOpen, openAndScrollTo } = useCitationsDisclosure(rootRef)

  useImperativeHandle(ref, () => ({ openAndScrollTo }))

  if (!sources.length) return null

  return (
    <div ref={rootRef}>
      <Citations
        citations={citations}
        title="Sources"
        idPrefix={idPrefix}
        open={open}
        onOpenChange={setOpen}
        className="mt-2"
      />
    </div>
  )
})
