/**
 * Dev harness. Not part of the shipped bundle — `src/index.ts` is the library
 * entry; this file is only ever loaded by `dev/index.html`.
 *
 * The route picks the mode, so you can work on one layout in isolation:
 *
 *   /            mode picker
 *   /floating    /inline    /fullscreen    /hostile
 *   /playground  /rag
 *
 * It mounts through the same `mount()` the real bundle uses, so the shadow
 * root, the injected stylesheet and the container logic are all exercised —
 * but Vite's dev server keeps HMR alive, unlike loading a built widget.js.
 */
import "./dev.css"

import { mount } from "../src/mount"
import { renderPlayground } from "./playground"
import { renderRag } from "./rag"
import { activeTenantId } from "./rag-source"
import type { Mode, Position, Theme, WidgetConfig } from "../src/lib/config"

type Route = Mode | "hostile" | "playground" | "rag" | "index"

const ROUTES: { path: string; label: string; hint: string }[] = [
  { path: "/floating", label: "Floating", hint: "Bubble trigger, fixed frame" },
  {
    path: "/inline",
    label: "Inline",
    hint: "Docked in a sidebar, always open",
  },
  { path: "/fullscreen", label: "Fullscreen", hint: "Covers the viewport" },
  { path: "/hostile", label: "Hostile CSS", hint: "Isolation stress test" },
  {
    path: "/playground",
    label: "Playground",
    hint: "Toggle which tools reach the model",
  },
  {
    path: "/rag",
    label: "RAG",
    hint: "Index a docs site and answer from it",
  },
]

function currentRoute(): Route {
  const path = location.pathname.replace(/\/+$/, "").toLowerCase()
  const name = path.slice(path.lastIndexOf("/") + 1)
  if (name === "floating" || name === "inline" || name === "fullscreen")
    return name
  if (name === "hostile") return "hostile"
  if (name === "playground") return "playground"
  if (name === "rag") return "rag"
  return "index"
}

/** Query params let you vary a mode without editing code: ?theme=light */
function params() {
  const q = new URLSearchParams(location.search)
  return {
    theme: (q.get("theme") ?? "dark") as Theme,
    position: (q.get("position") ?? "bottom-right") as Position,
    open: q.get("open") !== "false",
  }
}

const root = document.getElementById("dev-root")!

function chrome(active: Route, body: string) {
  const links = ROUTES.map(
    (r) =>
      `<a href="${r.path}"${
        active === r.path.slice(1) ? ' aria-current="page"' : ""
      }>${r.label}</a>`
  ).join("")
  return `
    <header class="bar">
      <a class="brand" href="/"><span class="dot">◆</span> Widget Dev</a>
      <nav>${links}</nav>
      <span class="hmr">HMR</span>
    </header>
    ${body}
  `
}

function renderIndex() {
  root.innerHTML = chrome(
    "index",
    `<div class="wrap">
      <p class="eyebrow">Dev harness</p>
      <h1>Pick a layout</h1>
      <p class="lede">
        Edits to <code>src/</code> hot-reload. Each route mounts the widget
        through the real shadow-root path, so what you see here matches the
        built bundle.
      </p>
      <div class="grid">
        ${ROUTES.map(
          (r) => `<a class="card" href="${r.path}">
            <h2>${r.label}</h2><p>${r.hint}</p>
          </a>`
        ).join("")}
      </div>
      <p class="lede small">
        Query params: <code>?theme=light</code> ·
        <code>?position=bottom-left</code> · <code>?open=false</code>
      </p>
    </div>`
  )
}

function renderMode(route: Route) {
  const p = params()
  const mode: Mode = route === "hostile" ? "floating" : (route as Mode)

  const filler = `
    <p class="eyebrow">Mode</p>
    <h1>${route}</h1>
    <p class="lede">
      Host-page content sits here. The widget should neither affect it nor be
      affected by it.
    </p>
    <div class="actions">
      <button onclick="window.__widget.open()">Open</button>
      <button onclick="window.__widget.close()">Close</button>
      <button onclick="window.__widget.toggle()">Toggle</button>
    </div>`

  if (mode === "inline") {
    root.innerHTML = chrome(
      route,
      `<div class="layout">
        <div class="wrap">${filler}</div>
        <aside class="dock"><div id="host"></div></aside>
      </div>`
    )
  } else {
    root.innerHTML = chrome(
      route,
      `<div class="wrap${route === "hostile" ? " hostile" : ""}">
        ${filler}
      </div>
      <div id="host"></div>`
    )
  }

  const config: WidgetConfig = {
    // ?api=… lets you point the harness at a deployed server instead.
    apiUrl:
      new URLSearchParams(location.search).get("api") ??
      "http://localhost:8788/chat",
    mode,
    position: p.position,
    theme: p.theme,
    trigger: "bubble",
    defaultOpen: mode === "inline" || p.open,
    /*
     * The namespace `/rag` last ingested into, not the server's default.
     *
     * These routes send no tool list, so retrieval is already in the model's
     * context here — but pointed at the default namespace it searched an
     * empty index whenever the docs had been ingested under any other name,
     * and answered from memory as if nothing had been indexed at all.
     */
    tenantId: activeTenantId(),
  }

  const widget = mount(document.getElementById("host") as HTMLElement, config)
  // Exposed for the buttons above and for poking at from the console.
  ;(window as unknown as { __widget: unknown }).__widget = {
    open: () => widget.handle?.open(),
    close: () => widget.handle?.close(),
    toggle: () => widget.handle?.toggle(),
  }
}

const route = currentRoute()
const api =
  new URLSearchParams(location.search).get("api") ??
  "http://localhost:8788/chat"

if (route === "index") renderIndex()
else if (route === "playground") {
  renderPlayground(root, (body) => chrome("playground", body), api)
} else if (route === "rag") {
  renderRag(root, (body) => chrome("rag", body), api)
} else renderMode(route)
