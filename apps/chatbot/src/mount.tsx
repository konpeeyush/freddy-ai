import { StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"

import { registerWidgets, STOCK_WIDGETS } from "@workspace/widgets"

// `?inline` hands us the compiled CSS as a string instead of letting Vite
// inject a <style> into the host page's <head> — which a shadow root cannot see.
import cssText from "./styles.css?inline"

import { App, type WidgetHandle } from "./app"
import type { WidgetConfig, Theme } from "./lib/config"

/*
 * Stock widget definitions.
 *
 * Registered here rather than in `src/index.ts` because `mount()` is the one
 * path every surface goes through — the shipped bundle, the dev harness, and
 * the playground all call it, but only the bundle imports the library entry.
 * Registering there left the harness with no definitions at all, so every
 * widget fell back to its summary text and looked like the model narrating
 * itself.
 *
 * Idempotent by construction: the registry keys on id and version, so
 * repeated calls overwrite rather than accumulate.
 */
registerWidgets(STOCK_WIDGETS)

/** One parsed sheet, shared by every widget instance on the page. */
let sheet: CSSStyleSheet | null = null
function getSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet()
    sheet.replaceSync(cssText)
  }
  return sheet
}

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "auto") return theme
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export type MountedWidget = {
  handle: WidgetHandle | null
  destroy: () => void
  setTheme: (theme: Theme) => void
  /** Swaps the tools in the model's context without touching the transcript. */
  setTools: (tools: string[] | undefined) => void
}

/**
 * Renders the widget into a closed shadow root on `host`.
 *
 * `closed` rather than `open` so host-page scripts cannot reach in via
 * `.shadowRoot` and mutate our DOM.
 */
export function mount(host: HTMLElement, config: WidgetConfig): MountedWidget {
  const shadow = host.attachShadow({ mode: "closed" })

  // adoptedStyleSheets is baseline since Safari 16.4 — no <style> tag needed.
  shadow.adoptedStyleSheets = [getSheet()]

  const container = document.createElement("div")
  container.style.display = "contents"
  shadow.appendChild(container)

  /*
   * Portalled popups (Base UI Popover/Select) mount here rather than into
   * `document.body`, which would escape the shadow root and its stylesheet.
   * It needs its own stacking context — the React container is
   * `display: contents`, so a portal appended to the bare shadow root has
   * nothing to stack against and paints behind the page.
   */
  const portal = document.createElement("div")
  portal.dataset.widgetPortal = ""
  portal.style.position = "fixed"
  portal.style.zIndex = "2147483001"
  portal.style.top = "0"
  portal.style.left = "0"
  // The layer itself must not swallow clicks; popups re-enable them.
  portal.style.pointerEvents = "none"
  shadow.appendChild(portal)

  // Tokens are declared on :host, so the theme flag belongs on the host too.
  host.setAttribute("data-theme", resolveTheme(config.theme))

  // Inline mode participates in the host's layout, so the host element itself
  // needs to be a sized block. Floating/fullscreen escape layout entirely.
  if (config.mode === "inline") {
    host.style.display = "block"
    host.style.height = host.style.height || "100%"

    /*
     * `height: 100%` silently resolves to `auto` when the page's container has
     * no definite height of its own — an aside in a grid row sized by
     * `min-height`, say. The panel then grows with the transcript instead of
     * scrolling it, and the composer walks off the bottom of the page.
     *
     * Measured here, before React renders, because this is the one moment the
     * answer is unambiguous: the host is still empty, so any height it reports
     * came from the page. Once there is content, an auto-height host reports
     * its content height and looks exactly like a sized one.
     */
    if (host.getBoundingClientRect().height === 0) host.style.height = "100dvh"
  } else {
    host.style.display = "contents"
  }

  const applyTheme = (theme: "light" | "dark") =>
    host.setAttribute("data-theme", theme)

  let handle: WidgetHandle | null = null
  const root: Root = createRoot(container)
  root.render(
    <StrictMode>
      <App
        portalContainer={portal}
        config={config}
        initialTheme={resolveTheme(config.theme)}
        onThemeChange={applyTheme}
        onReady={(h) => (handle = h)}
      />
    </StrictMode>
  )

  // Follow the OS when theme is "auto".
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
  const onScheme = () => handle?.setTheme(resolveTheme(config.theme))
  if (config.theme === "auto") mq?.addEventListener("change", onScheme)

  return {
    get handle() {
      return handle
    },
    setTheme(theme) {
      handle?.setTheme(resolveTheme(theme))
    },
    setTools(tools) {
      handle?.setTools(tools)
    },
    destroy() {
      if (config.theme === "auto") mq?.removeEventListener("change", onScheme)
      // Deferred: React warns if unmount happens during its own render cycle.
      queueMicrotask(() => root.unmount())
    },
  }
}
