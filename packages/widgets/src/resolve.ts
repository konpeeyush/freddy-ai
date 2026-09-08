import {
  isBind,
  type Bind,
  type Condition,
  type Format,
} from "./tree"

/*
 * Binding resolution.
 *
 * The entire dynamic surface of a widget is here: look a path up in the data,
 * optionally format it, optionally fall back. There is no expression parser
 * and nothing is evaluated — `resolve` walks an object with string keys.
 *
 * That is a deliberate ceiling. An author who needs a computed value puts it
 * in the schema and lets the model or the server supply it, which keeps this
 * module a lookup rather than an interpreter.
 */

/** Data visible to a subtree. `item`/`index` are set inside a `repeat`. */
export type Scope = {
  root: unknown
  item?: unknown
  index?: number
  /** Locale for money/date formatting. Follows the widget's active locale. */
  locale?: string
}

/**
 * Splits `$.a.b[0].c` into ["a", "b", "0", "c"].
 *
 * The leading `$.` / `$item.` has already been stripped by the caller.
 */
function segments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
}

/**
 * Walks a path against the scope.
 *
 * Prototype keys are refused: widget data is model-authored JSON, so a
 * `__proto__` segment must never reach an object lookup.
 */
export function resolvePath(path: string, scope: Scope): unknown {
  let base: unknown
  let rest: string

  if (path === "$index") return scope.index
  if (path === "$item") return scope.item

  if (path.startsWith("$item.")) {
    base = scope.item
    rest = path.slice("$item.".length)
  } else if (path.startsWith("$.")) {
    base = scope.root
    rest = path.slice("$.".length)
  } else {
    return undefined
  }

  for (const key of segments(rest)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return undefined
    }
    if (base === null || base === undefined) return undefined
    if (typeof base !== "object") return undefined
    base = (base as Record<string, unknown>)[key]
  }

  return base
}

// ── Formatting ────────────────────────────────────────────────────────────

/** Money as `{ amount, currency, formatted? }`, matching the existing library. */
type Money = { amount: number; currency: string; formatted?: string }

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Money).amount === "number" &&
    typeof (value as Money).currency === "string"
  )
}

/**
 * A pre-formatted string always wins. Storefronts disagree about minor units
 * (Shopify cents, Woo minor units, BigCommerce decimal), so a backend that
 * already knows the right shape should be able to hand it over intact.
 */
export function formatMoney(value: Money, locale?: string): string {
  if (value.formatted) return value.formatted
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: value.currency,
    }).format(value.amount)
  } catch {
    return `${value.currency} ${value.amount.toFixed(2)}`
  }
}

const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  time: { timeStyle: "short" },
  datetime: { dateStyle: "medium", timeStyle: "short" },
}

function formatDate(value: unknown, kind: string, locale?: string): string {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    return new Intl.DateTimeFormat(locale, DATE_STYLES[kind]).format(date)
  } catch {
    return date.toISOString()
  }
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
]

function formatRelative(value: unknown, locale?: string): string {
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  const diff = date.getTime() - Date.now()
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    for (const [unit, ms] of RELATIVE_UNITS) {
      if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
    }
    return rtf.format(Math.round(diff / 1000), "second")
  } catch {
    return date.toISOString()
  }
}

export function applyFormat(
  value: unknown,
  format: Format,
  locale?: string
): unknown {
  if (value === null || value === undefined) return value

  switch (format) {
    case "money":
      if (isMoney(value)) return formatMoney(value, locale)
      if (typeof value === "number") {
        // Bare number with no currency: format as a plain decimal rather than
        // guessing a symbol that would be wrong for most visitors.
        return new Intl.NumberFormat(locale).format(value)
      }
      return value
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat(locale).format(value)
        : value
    case "date":
    case "time":
    case "datetime":
      return formatDate(value, format, locale)
    case "relative-time":
      return formatRelative(value, locale)
  }
}

// ── Public resolution ─────────────────────────────────────────────────────

/** Resolves a `{ $bind }` object: lookup, then fallback, then format. */
export function resolveBind(bind: Bind, scope: Scope): unknown {
  const raw = resolvePath(bind.$bind, scope)
  const value =
    raw === null || raw === undefined || raw === ""
      ? bind.fallback !== undefined
        ? bind.fallback
        : raw
      : raw
  return bind.format ? applyFormat(value, bind.format, scope.locale) : value
}

/**
 * Resolves a prop value. Literals pass through; `$bind` objects resolve;
 * plain objects and arrays resolve recursively so `additionalInputs` can
 * carry bindings.
 */
export function resolveValue(value: unknown, scope: Scope): unknown {
  if (isBind(value)) return resolveBind(value, scope)
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope))
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveValue(v, scope)
    }
    return out
  }
  return value
}

/** Resolves every prop on a node in one pass. */
export function resolveProps(
  props: Record<string, unknown> | undefined,
  scope: Scope
): Record<string, unknown> {
  if (!props) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    out[key] = resolveValue(value, scope)
  }
  return out
}

/** Evaluates a `when` condition. Truthiness unless `is`/`oneOf` is given. */
export function testCondition(condition: Condition, scope: Scope): boolean {
  const value = resolvePath(condition.$bind, scope)

  let result: boolean
  if (condition.oneOf !== undefined) {
    result = condition.oneOf.some((candidate) => candidate === value)
  } else if (condition.is !== undefined) {
    result = value === condition.is
  } else {
    // Empty arrays are falsy here even though JS says otherwise — a template
    // hiding a list when it has no rows is the overwhelmingly common intent.
    result = Array.isArray(value) ? value.length > 0 : Boolean(value)
  }

  return condition.not ? !result : result
}

/** Coerces a resolved value to text for the string-taking primitives. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (isMoney(value)) return formatMoney(value)
  return ""
}
