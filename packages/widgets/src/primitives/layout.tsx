import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import {
  ALIGN,
  BACKGROUND,
  GAP,
  JUSTIFY,
  PADDING,
  RADIUS,
  dimension,
  token,
} from "../tokens"

/*
 * Layout primitives.
 *
 * Every one takes already-resolved props (bindings are gone by this point)
 * and maps them through the token scales. None of them accept a className or
 * a style object from the author — that constraint is the whole reason a
 * customer's widget cannot drift off-brand.
 */

export type PrimitiveProps = {
  props: Record<string, unknown>
  children?: ReactNode
}

/** Shared surface handling: background, padding, radius, border, size. */
function surfaceClasses(props: Record<string, unknown>): string {
  const border = props.border as
    | { size?: number; style?: string }
    | boolean
    | undefined

  return cn(
    props.background ? token(BACKGROUND, props.background, "") : "",
    props.padding !== undefined ? token(PADDING, props.padding, "") : "",
    props.radius ? token(RADIUS, props.radius, "") : "",
    border ? "border border-border" : ""
  )
}

function surfaceStyle(props: Record<string, unknown>): React.CSSProperties {
  const style: React.CSSProperties = {}
  const width = dimension(props.width)
  const height = dimension(props.height)
  if (width) style.width = width
  if (height) style.height = height
  if (typeof props.flex === "number") style.flex = props.flex
  // A literal hex is allowed only for background, and only because the gym
  // example's success chip needs one. Text colour stays token-only.
  if (typeof props.background === "string" && props.background.startsWith("#")) {
    style.backgroundColor = props.background
  }
  return style
}

export function Box({ props, children }: PrimitiveProps) {
  return (
    <div
      className={cn("min-w-0", surfaceClasses(props))}
      style={surfaceStyle(props)}
    >
      {children}
    </div>
  )
}

export function Row({ props, children }: PrimitiveProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-row",
        token(GAP, props.gap, "gap-2"),
        token(ALIGN, props.align, "items-center"),
        token(JUSTIFY, props.justify, "justify-start"),
        props.wrap ? "flex-wrap" : "",
        surfaceClasses(props)
      )}
      style={surfaceStyle(props)}
    >
      {children}
    </div>
  )
}

export function Col({ props, children }: PrimitiveProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        token(GAP, props.gap, "gap-2"),
        token(ALIGN, props.align, "items-stretch"),
        token(JUSTIFY, props.justify, "justify-start"),
        surfaceClasses(props)
      )}
      style={surfaceStyle(props)}
    >
      {children}
    </div>
  )
}

/**
 * A surface with elevation defaults. `padding={0}` is meaningful — the gym
 * card puts an edge-to-edge image inside one — so padding is only defaulted
 * when the prop is absent, never when it is explicitly zero.
 */
export function Card({ props, children }: PrimitiveProps) {
  const hasPadding = props.padding !== undefined
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden border border-border bg-card",
        token(RADIUS, props.radius, "rounded-xl"),
        hasPadding ? token(PADDING, props.padding, "") : "p-3",
        props.background ? token(BACKGROUND, props.background, "") : ""
      )}
      style={surfaceStyle(props)}
    >
      {children}
    </div>
  )
}

export function Divider({ props }: PrimitiveProps) {
  if (props.orientation === "vertical") {
    return <div className="w-px self-stretch bg-border" />
  }
  return <div className="h-px w-full bg-border" />
}

export function Spacer({ props }: PrimitiveProps) {
  const size = dimension(props.size) ?? "8px"
  return <div style={{ flexShrink: 0, width: size, height: size }} />
}
