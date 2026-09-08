/*
 * Token scales.
 *
 * Author props are tokens, never CSS: `gap={3}`, `color="tertiary"`,
 * `size="sm"`. Everything an author can write resolves through one of these
 * maps, so a widget cannot introduce an off-brand colour or an arbitrary
 * pixel value — and the same tree stays renderable on a surface that has no
 * Tailwind at all.
 *
 * Static class strings, not interpolation: Tailwind scans source text, so
 * `gap-${n}` would compile to nothing.
 */

/** 0–12 on the 4px scale, matching Tailwind's own spacing. */
export const GAP: Record<string, string> = {
  "0": "gap-0",
  "1": "gap-1",
  "2": "gap-2",
  "3": "gap-3",
  "4": "gap-4",
  "5": "gap-5",
  "6": "gap-6",
  "8": "gap-8",
  "10": "gap-10",
  "12": "gap-12",
}

export const PADDING: Record<string, string> = {
  "0": "p-0",
  "1": "p-1",
  "2": "p-2",
  "3": "p-3",
  "4": "p-4",
  "5": "p-5",
  "6": "p-6",
  "8": "p-8",
}

export const ALIGN: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
}

export const JUSTIFY: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
}

export const RADIUS: Record<string, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
}

/**
 * Surfaces, not raw colours. `surface-elevated` is the card-on-card case the
 * gym example uses; it has to stay legible against the panel background in
 * both themes, so it resolves to a token rather than a literal.
 */
export const BACKGROUND: Record<string, string> = {
  none: "bg-transparent",
  surface: "bg-background",
  "surface-elevated": "bg-card",
  muted: "bg-muted",
  accent: "bg-accent",
  primary: "bg-primary",
}

/** Text colour roles. Named by emphasis so they invert correctly in dark. */
export const TEXT_COLOR: Record<string, string> = {
  default: "text-foreground",
  emphasis: "text-foreground",
  secondary: "text-muted-foreground",
  tertiary: "text-muted-foreground/70",
  /*
   * Text on a themed primary surface. Flips with the theme, as it must —
   * `--primary-foreground` is near-white in light and near-black in dark.
   */
  inverse: "text-primary-foreground",
  /*
   * Text on a surface whose colour is pinned rather than themed — a card that
   * paints its own blue and looks the same either way. `inverse` is wrong
   * there: it follows the theme, so in dark mode it turns black on blue.
   */
  onColor: "text-white",
  onColorMuted: "text-white/75",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
  info: "text-sky-600 dark:text-sky-400",
}

export const TEXT_SIZE: Record<string, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
  "2xl": "text-xl",
  "3xl": "text-2xl",
}

export const TITLE_SIZE: Record<string, string> = {
  xs: "text-xs font-semibold",
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-lg font-semibold",
  xl: "text-xl font-semibold",
  "2xl": "text-2xl font-semibold",
}

export const WEIGHT: Record<string, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
}

export const TEXT_ALIGN: Record<string, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
}

/**
 * Semantic colours for Badge and Button. Kept apart from the theme accent:
 * "this is a beginner class" and "this is the primary action" are different
 * kinds of statement and should not share a swatch.
 */
export const BADGE_COLOR: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  success:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  discovery:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  warning:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
}

export const BUTTON_COLOR: Record<string, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
  success: "bg-emerald-600 text-white hover:bg-emerald-600/85",
  danger: "bg-destructive text-white hover:bg-destructive/85",
  neutral: "bg-muted text-foreground hover:bg-muted/70",
}

export const BUTTON_SIZE: Record<string, string> = {
  sm: "h-7 px-2.5 text-xs gap-1",
  md: "h-8 px-3 text-xs gap-1.5",
  lg: "h-9 px-4 text-sm gap-1.5",
}

export const OBJECT_FIT: Record<string, string> = {
  cover: "object-cover",
  contain: "object-contain",
  fill: "object-fill",
}

/** `maxLines` clamps rather than overflowing — cards must keep their height. */
export const CLAMP: Record<string, string> = {
  "1": "line-clamp-1",
  "2": "line-clamp-2",
  "3": "line-clamp-3",
  "4": "line-clamp-4",
}

/**
 * Looks a token up, falling back to the scale's default rather than emitting
 * nothing. A bad token from a model should degrade to a plain-looking element,
 * never to an unstyled one.
 */
export function token(
  scale: Record<string, string>,
  value: unknown,
  fallback: string
): string {
  if (value === null || value === undefined) return fallback
  return scale[String(value)] ?? fallback
}

/**
 * Width/height accept a token, a number (px), or a percentage string. This is
 * the one place a raw dimension is allowed — the gym example needs a 140px
 * image and a 100% button, and neither has a sensible token.
 */
export function dimension(value: unknown): string | undefined {
  if (typeof value === "number") return `${value}px`
  if (typeof value !== "string") return undefined
  if (value === "full" || value === "100%") return "100%"
  if (value === "auto") return "auto"
  if (/^\d+(\.\d+)?(px|%|rem|em)$/.test(value)) return value
  return undefined
}
