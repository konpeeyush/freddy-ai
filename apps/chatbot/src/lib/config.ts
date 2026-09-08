export type Mode = "floating" | "inline" | "fullscreen"
export type Position = "bottom-right" | "bottom-left" | "top-right" | "top-left"
export type Theme = "light" | "dark" | "auto"

export type WidgetConfig = {
  /** Where the chat server lives. Same-origin `/chat` by default. */
  apiUrl: string
  mode: Mode
  position: Position
  theme: Theme
  /** "none" lets the host page drive open/close via the JS API. */
  trigger: "bubble" | "none"
  defaultOpen: boolean
  /**
   * Restricts which tools reach the model.
   *
   * A development affordance, not a product feature: the playground sets it
   * so a developer can withhold a tool and watch how the model behaves. A
   * real embed leaves it undefined and the server applies its defaults —
   * which is why it has no matching HTML attribute.
   */
  tools?: string[]
  /**
   * Which knowledge base `searchKnowledge` reads.
   *
   * Also dev-only, and for a sharper reason than `tools`: in a real embed the
   * knowledge base is decided by the customer's authenticated key, and letting
   * a page name it would let any page name someone else's. The harness sets it
   * so a developer can ingest two sites and switch between them without
   * re-crawling.
   */
  tenantId?: string
}

/**
 * Dev default. A real deployment always passes `api-url`, since the widget
 * runs on the customer's origin, not ours.
 */
const DEFAULT_API_URL = "http://localhost:8788/chat"

const MODES: Mode[] = ["floating", "inline", "fullscreen"]
const POSITIONS: Position[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
]
const THEMES: Theme[] = ["light", "dark", "auto"]

function pick<T extends string>(
  value: string | null,
  allowed: T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function readConfig(el: Element): WidgetConfig {
  const get = (name: string) => el.getAttribute(name)
  const mode = pick(get("mode"), MODES, "floating")
  return {
    apiUrl: get("api-url") ?? DEFAULT_API_URL,
    mode,
    position: pick(get("position"), POSITIONS, "bottom-right"),
    theme: pick(get("theme"), THEMES, "auto"),
    trigger: get("trigger") === "none" ? "none" : "bubble",
    // Inline has no trigger, so it is open by definition.
    defaultOpen: mode === "inline" || get("default-open") === "true",
  }
}

/** Attributes that trigger a re-render when changed at runtime. */
export const OBSERVED_ATTRIBUTES = [
  "api-url",
  "mode",
  "position",
  "theme",
  "trigger",
  "default-open",
]
