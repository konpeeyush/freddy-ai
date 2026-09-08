import { ChatPanel } from "../chat/panel"
import { Bubble } from "../triggers/bubble"
import { cn } from "@workspace/ui/lib/utils"
import type { Position } from "../lib/config"

/**
 * Floating frame: a fixed-position shell pinned to a corner of the viewport.
 * The bubble is only a trigger — this frame is what actually holds the panel.
 */
export function FloatingContainer({
  open,
  onToggle,
  position,
  showTrigger,
}: {
  open: boolean
  onToggle: () => void
  position: Position
  showTrigger: boolean
}) {
  const isRight = position.endsWith("right")
  const isBottom = position.startsWith("bottom")

  return (
    <div
      className={cn(
        // pointer-events-none so the host page stays clickable around the widget.
        // w-fit/h-auto keep this wrapper hugging its children — without it the
        // fixed box stretches and the panel loses its card shape.
        "pointer-events-none fixed z-[2147483000] flex h-auto w-fit flex-col gap-3 p-4",
        isBottom ? "bottom-0" : "top-0",
        isRight ? "right-0 items-end" : "left-0 items-start",
        !isBottom && "flex-col-reverse"
      )}
    >
      {open && (
        <div
          className={cn(
            // 760px rather than 600: a support thread runs long and the frame
            // was scrolling well before the viewport ran out. The dvh clamp
            // keeps it inside shorter windows.
            "pointer-events-auto flex h-[min(760px,calc(100dvh-7rem))] w-[min(440px,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl",
            "animate-in duration-200 zoom-in-95 fade-in",
            isBottom
              ? isRight
                ? "origin-bottom-right"
                : "origin-bottom-left"
              : isRight
                ? "origin-top-right"
                : "origin-top-left"
          )}
        >
          <ChatPanel onClose={onToggle} />
        </div>
      )}
      {showTrigger && <Bubble open={open} onClick={onToggle} />}
    </div>
  )
}
