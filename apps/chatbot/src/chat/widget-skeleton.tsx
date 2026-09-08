import { cn } from "@workspace/ui/lib/utils"

import { GridReveal } from "./grid-reveal"

/*
 * Shapes the placeholder can take, matched to how the widget it precedes is
 * actually laid out — see the stock definitions in packages/widgets/src/stock.
 *
 * "card"     one box. Weather, exchange-rate, article-summary, lead-capture —
 *            anything that renders as a single `Card`.
 * "list"     stacked rows. Crypto prices, stay options — anything built from
 *            `ListView`/`Col` with one row per result.
 * "carousel" a horizontal strip. Widgets built from the `Carousel` primitive,
 *            e.g. place results.
 */
export type SkeletonShape = "card" | "list" | "carousel"

/** Rows/items shown regardless of how many results eventually come back — this is a placeholder, not a live count. */
const LIST_ROWS = 4
const CAROUSEL_ITEMS = 3

/** Width over height for one row or carousel item. */
const ROW_ASPECT = 5.5
const CAROUSEL_ITEM_ASPECT = 3 / 4

export type WidgetSkeletonProps = {
  shape?: SkeletonShape
  /** Resolve into this image, when there is one. Only used by the "card" shape. */
  src?: string | null
  /** Describes what is loading, for assistive technology. */
  label?: string
  /** Roughly how long the work takes, for pacing when there is no progress. */
  estimatedDuration?: number
  /** True once the real content is ready — every box then resolves together. */
  done?: boolean
  className?: string
}

export function WidgetSkeleton({
  shape = "card",
  src,
  label = "Loading",
  estimatedDuration,
  done = false,
  className,
}: WidgetSkeletonProps) {
  if (shape === "list") {
    return (
      <div
        role="status"
        aria-label={label}
        aria-live="polite"
        className={cn("flex flex-col gap-2", className)}
      >
        {Array.from({ length: LIST_ROWS }, (_, i) => (
          <GridReveal
            key={i}
            aspect={ROW_ASPECT}
            estimatedDuration={estimatedDuration}
            done={done}
            decorative
          />
        ))}
      </div>
    )
  }

  if (shape === "carousel") {
    return (
      <div
        role="status"
        aria-label={label}
        aria-live="polite"
        className={cn("flex gap-2 overflow-x-hidden", className)}
      >
        {Array.from({ length: CAROUSEL_ITEMS }, (_, i) => (
          <GridReveal
            key={i}
            aspect={CAROUSEL_ITEM_ASPECT}
            estimatedDuration={estimatedDuration}
            done={done}
            className="w-40 shrink-0"
            decorative
          />
        ))}
      </div>
    )
  }

  return (
    <GridReveal
      src={src}
      label={label}
      aspect={16 / 9}
      estimatedDuration={estimatedDuration}
      done={done}
      className={className}
    />
  )
}
