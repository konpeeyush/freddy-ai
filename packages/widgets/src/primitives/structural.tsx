import { Children, useCallback, useEffect, useRef, useState } from "react"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@workspace/ui/lib/utils"

import { asText } from "../resolve"
import { GAP, dimension, token } from "../tokens"
import { ICONS } from "./icons"
import type { PrimitiveProps } from "./layout"

/*
 * Structural primitives — the collection containers, plus Chart.
 */

/**
 * A vertical collection with an optional status header ("Upcoming classes",
 * "2 items in cart"). The header is what gives a widget its identity in the
 * transcript, so it sits above the card rather than inside it.
 */
export function ListView({ props, children }: PrimitiveProps) {
  const status = props.status as
    | { text?: unknown; icon?: unknown }
    | undefined
  const statusText = status ? asText(status.text) : ""
  const statusIcon = status ? ICONS[asText(status.icon)] : null

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {statusText ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {statusIcon ? (
            <HugeiconsIcon icon={statusIcon} className="size-3.5" />
          ) : null}
          {statusText}
        </div>
      ) : null}
      <div className={cn("flex flex-col", token(GAP, props.gap, "gap-2"))}>
        {children}
      </div>
    </div>
  )
}

export function ListViewItem({ props, children }: PrimitiveProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        token(GAP, props.gap, "gap-2")
      )}
    >
      {children}
    </div>
  )
}

/**
 * Horizontal scroll-snap.
 *
 * Scroll-snap rather than a JS carousel: no library, no measurement, and it
 * degrades to a plain scroller wherever snap is unsupported. `itemWidth` is
 * applied to the children here because the child nodes cannot size
 * themselves against a parent they do not know about.
 */
export function Carousel({ props, children }: PrimitiveProps) {
  const itemWidth = dimension(props.itemWidth) ?? "240px"

  /*
   * Arrows, shown only where they would do something.
   *
   * Scroll-snap gives a touch device everything it needs, but on a desktop
   * the row reads as a static card until something suggests it moves — a
   * trackpad user has no affordance at all, and the hidden scrollbar (which
   * is right: a bar under a card row is chrome) removed the last hint.
   *
   * The state is which direction is still available, so a button never
   * appears over an edge it cannot move past. Measured rather than counted:
   * how many cards fit depends on the panel's width, which nothing here
   * knows.
   */
  const viewport = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const element = viewport.current
    if (!element) return
    const { scrollLeft, scrollWidth, clientWidth } = element
    setCanScroll({
      left: scrollLeft > 1,
      // A pixel of slack: sub-pixel layout leaves a fraction behind at the
      // end, and an arrow that never switches off looks broken.
      right: scrollLeft + clientWidth < scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!element) return

    measure()
    /*
     * Re-measured on resize as well as scroll: the panel can be dragged
     * wider, and a row that fitted at one width may not at another.
     */
    /*
     * The viewport *and* its contents.
     *
     * `measure` compares `scrollLeft + clientWidth` against `scrollWidth`.
     * The first two change when the panel resizes, which observing the
     * viewport catches — but `scrollWidth` changes when a child grows, and a
     * card grows when its image finally loads. Observing only the container
     * left the right-hand arrow hidden over a row that had just become
     * scrollable, which reads as the carousel having nothing more to show.
     *
     * `load` as well, because an image arriving does not always change the
     * slot's own box: the slot is a fixed width, so a late image can repaint
     * inside it without the observer firing at all.
     */
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)

    element.addEventListener("load", measure, true)

    return () => {
      observer.disconnect()
      element.removeEventListener("load", measure, true)
    }
  }, [measure, children])

  /** One viewport-width, less a card's overhang so context is kept. */
  const page = (direction: 1 | -1) => {
    const element = viewport.current
    if (!element) return
    element.scrollBy({
      left: direction * Math.max(element.clientWidth * 0.8, 120),
      behavior: "smooth",
    })
  }

  /*
   * Every child gets its own slot, so `children` has to be the items to lay
   * out rather than one node containing them. `RenderNode` guarantees that by
   * expanding a repeating child into siblings before it builds this list —
   * see the note there. `Children.toArray` would not do the job: it counts a
   * fragment as one child, not as its contents.
   */
  const items = Children.toArray(children)

  return (
    /*
     * `group` so the arrows can appear on hover, and relative so they can sit
     * over the row rather than beside it — a row inset to make room for two
     * buttons loses a card's worth of width on a 380px panel.
     */
    <div className="group relative w-full min-w-0">
      <div
        ref={viewport}
        onScroll={measure}
        className={cn(
          "flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto scroll-smooth pb-1",
          // Hides the scrollbar without the plugin — the snap points are the
          // affordance, and a bar under a card row reads as chrome.
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          token(GAP, props.gap, "gap-2")
        )}
      >
        {items.map((child, index) => (
          /*
           * The slot is a column so its card stretches to the row's height
           * rather than to its own content.
           *
           * A flex row already makes every slot the same height, but a card
           * inside one sizes to what it holds — so a place with no distance
           * badge produced a visibly shorter card beside a taller one, with a
           * strip of panel showing under it.
           *
           * Filling the height is only half of it, though: a card stretched
           * to the row leaves its own content floating with a gap beneath,
           * which looks like a different bug rather than a fixed one. So the
           * slot hands the height down an unbroken chain —
           *
           *   [&>*]:h-full / flex / flex-col     the card takes the height
           *   [&>*>*:last-child]:flex-1          its last section absorbs it
           *   [&>*>*:last-child]:flex / flex-col
           *                                      and passes it on in turn
           *
           * — because the section in between is usually a plain Box, which is
           * not a flex container and would otherwise swallow the height
           * rather than hand it to the column inside. Written as descendant
           * selectors so the primitive needs no cooperation from the tree.
           */
          <div
            key={index}
            className={cn(
              "flex shrink-0 snap-start flex-col",
              "[&>*]:flex [&>*]:h-full [&>*]:flex-col",
              "[&>*>*:last-child]:flex [&>*>*:last-child]:flex-1 [&>*>*:last-child]:flex-col"
            )}
            style={{ width: itemWidth }}
          >
            {child}
          </div>
        ))}
      </div>

      <CarouselArrow
        direction="left"
        show={canScroll.left}
        onClick={() => page(-1)}
      />
      <CarouselArrow
        direction="right"
        show={canScroll.right}
        onClick={() => page(1)}
      />
    </div>
  )
}

/**
 * One scroll button.
 *
 * Faded rather than unmounted when it cannot move, so the row does not shift
 * as the last card comes into view — and `pointer-events-none` so an
 * invisible button is not still clickable.
 */
function CarouselArrow({
  direction,
  show,
  onClick,
}: {
  direction: "left" | "right"
  show: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      aria-label={direction === "left" ? "Scroll left" : "Scroll right"}
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full p-1.5",
        "bg-background/90 text-foreground shadow-md ring-1 ring-border backdrop-blur",
        "transition-opacity duration-150",
        direction === "left" ? "left-1" : "right-1",
        show
          ? /*
             * Visible on touch, where there is no hover to reveal them, and
             * on keyboard focus. Hover only hides them on a desktop, which is
             * the one place a pointer makes them redundant anyway.
             */
            "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          : "pointer-events-none opacity-0"
      )}
    >
      <HugeiconsIcon
        icon={direction === "left" ? ArrowLeft01Icon : ArrowRight01Icon}
        className="size-4"
      />
    </button>
  )
}

/**
 * Bar and line charts, hand-drawn as SVG.
 *
 * No charting library on purpose: the widget bundle already loads on other
 * people's pages at ~234 KB gzipped, and the two shapes a chat widget
 * actually needs are perfectly drawable in about fifty lines.
 */
export function Chart({ props }: PrimitiveProps) {
  const raw = Array.isArray(props.data) ? props.data : []
  const values = raw
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((value) => Number.isFinite(value))

  if (values.length === 0) return null

  const labels = Array.isArray(props.labels) ? props.labels.map(asText) : []
  const height = typeof props.height === "number" ? props.height : 120
  const type = props.type === "line" ? "line" : "bar"

  /*
   * Bars anchor at zero; lines do not.
   *
   * A bar with a floating baseline exaggerates differences, which is the
   * classic way to mislead with a usage graph — its length is the value, so
   * the axis has to start at nothing.
   *
   * A line means the opposite: it shows a shape over time, and forcing zero
   * flattens anything whose variation is small next to its magnitude. An
   * exchange rate moving 95.12 → 95.76 is a real week's movement, and against
   * a zero baseline it occupies two thirds of one percent of the height —
   * a straight line, which is a wrong answer rather than a cautious one.
   */
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const max = type === "bar" ? Math.max(hi, 0) : hi
  const min = type === "bar" ? Math.min(lo, 0) : lo

  /*
   * A flat series has no span to divide by. Falling back to 1 would pin it to
   * the bottom edge; centring reads as what it is — a value that did not move.
   */
  const flat = max === min
  const span = flat ? 1 : max - min

  const width = 300
  const padding = 4
  const usable = height - padding * 2
  const step = width / values.length

  const color =
    props.color === "success"
      ? "var(--color-emerald-500, #10b981)"
      : props.color === "danger"
        ? "var(--destructive)"
        : "var(--primary)"

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={asText(props.label) || `${type} chart`}
      >
        {type === "bar"
          ? values.map((value, index) => {
              const barHeight = (Math.abs(value - min) / span) * usable
              const barWidth = step * 0.62
              return (
                <rect
                  key={index}
                  x={index * step + (step - barWidth) / 2}
                  y={height - padding - barHeight}
                  width={barWidth}
                  height={Math.max(barHeight, 1)}
                  rx={2}
                  fill={color}
                />
              )
            })
          : (() => {
              const points = values
                .map((value, index) => {
                  const x = index * step + step / 2
                  const y = flat
                    ? height / 2
                    : height - padding - ((value - min) / span) * usable
                  return `${x},${y}`
                })
                .join(" ")
              return (
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })()}
      </svg>

      {/*
        First and last only.
        
        One label per point sounds informative and is not: a month of daily
        rates is twenty-odd labels sharing 300px, each truncating to a single
        character, so the axis reads "J.A.A.A.A." A series this dense is read
        for its shape, and the only labels that anchor that shape are its
        ends.
      */}
      {labels.length === values.length && labels.length > 0 ? (
        <div className="flex w-full items-baseline justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            {labels[0]}
          </span>
          {labels.length > 1 ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {labels[labels.length - 1]}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
