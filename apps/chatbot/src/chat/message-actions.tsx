import { forwardRef, useImperativeHandle, useRef } from "react"
import { motion, useReducedMotion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

import type { MessageSource } from "@workspace/api"

import { AgentDisclosure } from "@workspace/ui/components/chat/agent-disclosure"
import { CitationList, CitationStack } from "@workspace/ui/components/chat/citations"
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@workspace/ui/lib/ease"
import {
  useCitationsDisclosure,
  useSourceCitations,
  type SourcesHandle,
} from "@workspace/ui/components/chat/sources"
import { useWidgetConfig } from "../lib/widget-config"

/*
 * Sources trigger under a finished reply — the only action row a reply
 * gets. Only rendered once the reply has settled and only when it actually
 * cited something; a reply with no citations gets no row at all.
 */

/** Small, plain-text trigger meant to sit inline among icon buttons — the
 *  full labelled pill (`Citations` itself) reads as its own control, which
 *  is right on its own line but competes with the row it would share here. */
function SourcesTrigger({
  citations,
  open,
  onToggle,
  contentId,
}: {
  citations: ReturnType<typeof useSourceCitations>
  open: boolean
  onToggle: () => void
  contentId: string
}) {
  const reduce = useReducedMotion() ?? false

  return (
    <motion.button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={onToggle}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      transition={SPRING_PRESS}
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <CitationStack citations={citations} limit={3} size="xs" />
      <span className="text-xs font-medium tabular-nums">
        {citations.length} source{citations.length === 1 ? "" : "s"}
      </span>
      <motion.span
        aria-hidden="true"
        animate={{ rotate: open ? 180 : 0 }}
        transition={reduce ? { duration: 0 } : SPRING_SWAP}
        className="text-muted-foreground/60"
      >
        <HugeiconsIcon icon={ArrowDown01Icon} className="size-3" />
      </motion.span>
    </motion.button>
  )
}

export type MessageActionsHandle = SourcesHandle

export const MessageActions = forwardRef<
  MessageActionsHandle,
  {
    /** What this reply cited, if anything — nothing renders without it. */
    sources?: MessageSource[]
    /** Shared with `Markdown`'s inline citation markers for this message. */
    idPrefix?: string
  }
>(function MessageActions({ sources = [], idPrefix }, ref) {
  const reduce = useReducedMotion() ?? false
  const rootRef = useRef<HTMLDivElement>(null)
  const { apiUrl } = useWidgetConfig()
  const citations = useSourceCitations(sources, apiUrl)
  const { open, toggle, revealIntoView, openAndScrollTo } =
    useCitationsDisclosure(rootRef)
  const contentId = `${idPrefix ?? "citations"}-content`

  useImperativeHandle(ref, () => ({ openAndScrollTo }))

  if (!citations.length) return null

  return (
    <div ref={rootRef}>
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
        className="mt-2 flex items-center"
      >
        <SourcesTrigger
          citations={citations}
          open={open}
          onToggle={toggle}
          contentId={contentId}
        />
      </motion.div>

      <AgentDisclosure
        id={contentId}
        open={open}
        // Once the box has finished growing — see `revealIntoView` for why
        // a list opened at the end of the transcript needs this at all.
        onAnimationComplete={revealIntoView}
      >
        {/* The gap belongs to the list, not the box around it: a margin on
            the element being animated survives `height: 0`, so a closed
            disclosure would hold a few pixels open forever and the collapse
            would visibly stop short of gone. */}
        <CitationList citations={citations} idPrefix={idPrefix} className="mt-1.5" />
      </AgentDisclosure>
    </div>
  )
})
