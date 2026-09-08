import { HugeiconsIcon } from "@hugeicons/react"

import { cn } from "@workspace/ui/lib/utils"

import { asText } from "../resolve"
import { isSafeUrl } from "../tree"
import {
  BADGE_COLOR,
  CLAMP,
  OBJECT_FIT,
  RADIUS,
  TEXT_ALIGN,
  TEXT_COLOR,
  TEXT_SIZE,
  TITLE_SIZE,
  WEIGHT,
  dimension,
  token,
} from "../tokens"
import { ICONS } from "./icons"
import type { PrimitiveProps } from "./layout"

/*
 * Content primitives.
 *
 * These take a `value` prop rather than children: a widget's text always
 * comes from data, and making it a prop is what lets the compiler emit a
 * `$bind` in the one place text can appear.
 */

export function Title({ props }: PrimitiveProps) {
  const value = asText(props.value)
  if (!value) return null
  return (
    <p
      className={cn(
        "min-w-0 text-foreground",
        token(TITLE_SIZE, props.size, "text-base font-semibold"),
        props.textAlign ? token(TEXT_ALIGN, props.textAlign, "") : "",
        props.maxLines ? token(CLAMP, props.maxLines, "") : "",
        props.color ? token(TEXT_COLOR, props.color, "") : ""
      )}
    >
      {value}
    </p>
  )
}

export function Text({ props }: PrimitiveProps) {
  const value = asText(props.value)
  if (!value) return null
  return (
    <p
      className={cn(
        "min-w-0",
        token(TEXT_SIZE, props.size, "text-sm"),
        token(TEXT_COLOR, props.color, "text-foreground"),
        props.weight ? token(WEIGHT, props.weight, "") : "",
        props.textAlign ? token(TEXT_ALIGN, props.textAlign, "") : "",
        props.maxLines ? token(CLAMP, props.maxLines, "") : ""
      )}
    >
      {value}
    </p>
  )
}

export function Caption({ props }: PrimitiveProps) {
  const value = asText(props.value)
  if (!value) return null
  return (
    <p
      className={cn(
        "min-w-0",
        token(TEXT_SIZE, props.size, "text-xs"),
        token(TEXT_COLOR, props.color, "text-muted-foreground"),
        props.textAlign ? token(TEXT_ALIGN, props.textAlign, "") : ""
      )}
    >
      {value}
    </p>
  )
}

export function Image({ props }: PrimitiveProps) {
  const src = asText(props.src)
  /*
   * The URL came from model-authored data, so it is untrusted. The schema
   * checked it, but this is the sink — never trust that validation ran.
   */
  if (!src || !isSafeUrl(src)) return null

  const width = dimension(props.width)
  const height = dimension(props.height)

  return (
    <img
      src={src}
      alt={asText(props.alt)}
      loading="lazy"
      className={cn(
        "shrink-0",
        token(OBJECT_FIT, props.fit, "object-cover"),
        props.radius ? token(RADIUS, props.radius, "") : ""
      )}
      style={{
        width: width ?? "100%",
        height: height ?? "auto",
        // A percentage height only resolves against a sized parent; the gym
        // card relies on the Row being stretch-aligned for this.
        alignSelf: height === "100%" ? "stretch" : undefined,
      }}
    />
  )
}

export function Icon({ props }: PrimitiveProps) {
  const icon = ICONS[asText(props.name)]
  if (!icon) return null

  const size = dimension(props.size)
  const color = asText(props.color)
  // A hex passes through as an inline colour; anything else is a token.
  const isLiteral = color.startsWith("#")

  return (
    <HugeiconsIcon
      icon={icon}
      className={cn(
        "shrink-0",
        size ? "" : "size-4",
        isLiteral ? "" : token(TEXT_COLOR, props.color, "text-foreground")
      )}
      style={{
        width: size,
        height: size,
        color: isLiteral ? color : undefined,
      }}
    />
  )
}

export function Badge({ props }: PrimitiveProps) {
  const label = asText(props.label)
  if (!label) return null
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center font-medium",
        props.size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        props.pill ? "rounded-full" : "rounded-md",
        token(BADGE_COLOR, props.color, BADGE_COLOR.neutral)
      )}
    >
      {label}
    </span>
  )
}

/** Read-only stars. The hotel card's "4.8 (124 reviews)" row. */
export function Rating({ props }: PrimitiveProps) {
  const value = typeof props.value === "number" ? props.value : 0
  const max = typeof props.max === "number" ? props.max : 5
  const filled = Math.round(Math.max(0, Math.min(value, max)))

  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex">
        {Array.from({ length: max }, (_, i) => (
          <HugeiconsIcon
            key={i}
            icon={ICONS.star}
            className={cn(
              "size-3.5",
              i < filled
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            )}
          />
        ))}
      </span>
      {props.showValue !== false ? (
        <span className="text-xs font-medium tabular-nums">
          {value.toFixed(1)}
        </span>
      ) : null}
    </span>
  )
}

export function Progress({ props }: PrimitiveProps) {
  const value = typeof props.value === "number" ? props.value : 0
  const max = typeof props.max === "number" && props.max > 0 ? props.max : 100
  const pct = Math.max(0, Math.min(100, (value / max) * 100))

  const fill =
    props.color === "success"
      ? "bg-emerald-600"
      : props.color === "danger"
        ? "bg-destructive"
        : props.color === "warning"
          ? "bg-amber-500"
          : "bg-primary"

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
