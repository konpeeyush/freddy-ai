import { useEffect, useState } from "react"

import { Dotm3x3_16 } from "@workspace/ui/components/ui/dotm-3x3-16"

import { FREDDY_COLOR } from "./freddy"

/*
 * Waiting indicator: a 3×3 pixel grid with a chevron wavefront driving right,
 * a shimmering label, and a live elapsed timer.
 *
 * Three bouncing dots say "typing" — fine when a reply is instant. A model
 * call is not instant, so this says "working, and here is how long for",
 * which is the honest signal while tokens are still upstream.
 */

/*
 * Delay per cell, in ms. `(column + |row - 1|) * 90` makes the middle row lead
 * and the outer rows trail, so the front reads as a chevron rather than a
 * flat column. The 650ms cycle is shorter than the full sweep, so two fronts
 * are in flight at once and the grid never looks empty.
 */
const CHEVRON = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3)
  const col = i % 3
  return (col + Math.abs(row - 1)) * 90
})

const CYCLE_MS = 650

/**
 * The dot matrix's colour.
 *
 * Off Freddy's palette on purpose: the matrix marks the one moment he is not
 * answering out of his own head, and a red nothing like his clay is what
 * makes that moment legible at a glance.
 */
const MATRIX_COLOR = "#ff3b30"

function LoaderGrid() {
  return (
    <span
      aria-hidden
      className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]"
    >
      {CHEVRON.map((delay, index) => (
        <span
          key={index}
          className="size-1 rounded-full"
          style={{
            // Freddy's own clay tone: the wavefront is a hairline of 4px dots, so
            // it can carry the colour at full strength without shouting.
            backgroundColor: FREDDY_COLOR,
            opacity: 0.15,
            animation: `widget-pixel-on ${CYCLE_MS}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  )
}

/** Tenths of a second, so the timer visibly moves rather than sitting still. */
function useElapsed() {
  const [tenths, setTenths] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTenths((t) => t + 1), 100)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = tenths / 10
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`
}

/**
 * Which mark spins while waiting.
 *
 * "chevron" — the built-in wavefront grid, for the model thinking on its own.
 * Quiet, because that is the state a visitor sits in most.
 *
 * "matrix" — the dot-matrix glyph, for any tool call. Freddy has left to go
 * and look something up, which is worth a mark of its own; when the tool also
 * draws a widget it sits above that widget's skeleton, so the two together
 * still read as one event rather than two indicators.
 */
export type ThinkingLoader = "chevron" | "matrix"

export function Thinking({
  label = "Thinking",
  loader = "chevron",
}: {
  label?: string
  loader?: ThinkingLoader
}) {
  const elapsed = useElapsed()

  return (
    <div role="status" className="flex w-fit items-center gap-2.5 py-1">
      {loader === "matrix" ? (
        <Dotm3x3_16
          size={16}
          color={MATRIX_COLOR}
          ariaLabel={label}
          className="shrink-0"
        />
      ) : (
        <LoaderGrid />
      )}
      <span
        className="bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
          backgroundSize: "200% 100%",
          animation: "widget-shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
        {elapsed}
      </span>
    </div>
  )
}
