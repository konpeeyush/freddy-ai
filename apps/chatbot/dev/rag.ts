/**
 * Retrieval page.
 *
 * Point it at a documentation site, watch it get crawled and indexed, then ask
 * the same question two ways: through search on its own, and through the
 * widget with the model in the loop.
 *
 * Both halves are here on purpose. When a support bot answers badly there are
 * two entirely different causes — retrieval never found the passage, or it
 * found it and the model ignored it — and they have opposite fixes. Chunking
 * and prompting respectively. A page that only showed the chat reply cannot
 * tell you which one you have, which is how people end up rewriting a prompt
 * to fix a chunking bug.
 *
 * The ingest log is shown for the same reason. A crawl that produces twelve
 * chunks from a four-hundred-page site has gone wrong somewhere specific — a
 * client-rendered docs app, a sitemap scoped too narrowly, pages behind auth
 * — and the skipped list names it.
 *
 * Dev-only. Nothing here reaches widget.js.
 */

import { mount } from "../src/mount"
import { serverOrigin } from "./server-origin"
import { escapeHtml as esc } from "./html-escape"
import type { WidgetConfig } from "../src/lib/config"
import {
  loadRagSource,
  saveRagSource,
  type RagSourceSettings,
} from "./rag-source"
import type { RagHit, RagSource } from "@workspace/api"

/**
 * Events the ingest stream sends. Mirrors `IngestEvent` in `@workspace/rag`,
 * declared structurally rather than imported: that package opens SQLite and
 * reads the filesystem, so importing its types would pull a Bun-only module
 * into the browser bundle for the sake of a union.
 */
type IngestEvent =
  | { kind: "start"; origin: string }
  | { kind: "page"; url: string; title: string; chunks: number; done: number }
  | { kind: "skip"; url: string; reason: string }
  | { kind: "unchanged"; url: string; done: number }
  | {
      kind: "done"
      pages: number
      chunks: number
      skipped: number
      unchanged: number
      removed: number
      tokens: number
      ms: number
    }
  | { kind: "error"; message: string }

/** "2 minutes ago", for the sources list. Absolute timestamps read as noise. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Reads a server-sent event stream as parsed objects.
 *
 * Hand-rolled rather than `EventSource`, which only issues GETs and so cannot
 * carry the ingest options in a body. The buffering matters: a chunk boundary
 * lands mid-event often enough that parsing per-read rather than per-event
 * drops roughly one event in twenty, which shows up as a progress count that
 * skips numbers.
 */
async function* readEvents<T>(
  response: Response,
  signal: AbortSignal
): AsyncGenerator<T> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        const line = frame
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5)
          .trim()
        if (!line) continue
        try {
          yield JSON.parse(line) as T
        } catch {
          // A truncated frame is not worth aborting a crawl over.
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function renderRag(
  root: HTMLElement,
  chrome: (body: string) => string,
  apiUrl: string
): void {
  const origin = serverOrigin(apiUrl)
  let saved: RagSourceSettings = loadRagSource()

  /*
   * Retrieval starts on.
   *
   * The comparison this page exists for is "with the docs versus without", and
   * a visitor arriving to a bot that has not been told about its own
   * documentation is the less interesting half.
   */
  let retrievalOn = true
  let ingesting = false
  let ingestAbort: AbortController | null = null

  root.innerHTML = chrome(
    `<div class="pg">
      <aside class="pg-panel">
        <div class="pg-head">
          <div class="rag-head-row">
            <h1>Knowledge base</h1>
            <!-- The switch belongs to the knowledge base, not to the widget:
                 it is this panel's subject that it turns on and off. -->
            <label class="rag-switch">
              <span>Retrieval</span>
              <input type="checkbox" class="rag-retrieval" role="switch"
                checked />
              <span class="rag-switch-track" aria-hidden="true"></span>
            </label>
          </div>
          <p class="lede small">
            Crawl a documentation site, then ask the widget about it. The
            answer is grounded in what was indexed — search below shows exactly
            which passages it had to work with.
          </p>
          <p class="rag-stage-note"></p>
        </div>

        <form class="pg-form rag-form" novalidate>
          <label>
            <span>Documentation URL</span>
            <input name="url" type="url" autocomplete="off"
              placeholder="https://docs.example.com"
              value="${esc(saved.url)}" />
            <small>
              A path scopes the crawl — <code>/docs</code> takes the docs and
              leaves the blog. The sitemap is used when there is one.
            </small>
            <em data-error="url"></em>
          </label>

          <div class="rag-row">
            <label>
              <span>Max pages</span>
              <input name="maxPages" type="number" min="1" max="500"
                value="${saved.maxPages}" />
              <small>Each page costs embeddings.</small>
            </label>
            <label>
              <span>Namespace</span>
              <input name="tenantId" autocomplete="off"
                value="${esc(saved.tenantId)}" />
              <small>Keeps two sites apart.</small>
            </label>
          </div>

          <label class="rag-check">
            <input type="checkbox" name="prune" />
            <span>Remove stored pages the crawl no longer finds</span>
            <small>
              Leave off for a first run — a crawl stopped by the page limit
              would delete the part of the site it never reached.
            </small>
          </label>

          <div class="pg-form-actions">
            <button type="submit" class="rag-go">Ingest</button>
            <button type="button" class="pg-secondary rag-cancel" hidden>
              Stop
            </button>
          </div>
        </form>

        <div class="rag-progress" hidden>
          <div class="rag-counts"></div>
          <ol class="rag-log"></ol>
        </div>

        <div class="pg-head pg-head-seq">
          <h2>Indexed</h2>
        </div>
        <div class="rag-sources"></div>

        <div class="pg-head pg-head-seq">
          <h2>Search</h2>
          <p class="lede small">
            Retrieval on its own, with no model in the way. If the right
            passage is not here, no amount of prompting will fix the answer.
          </p>
        </div>
        <form class="rag-search" novalidate>
          <input name="query" autocomplete="off"
            placeholder="what is your refund policy?" />
          <button type="submit">Search</button>
        </form>
        <div class="rag-hits"></div>
      </aside>

      <div class="pg-stage">
        <div id="host"></div>
      </div>
    </div>`
  )

  const form = root.querySelector(".rag-form") as HTMLFormElement
  const searchForm = root.querySelector(".rag-search") as HTMLFormElement
  const goButton = root.querySelector(".rag-go") as HTMLButtonElement
  const cancelButton = root.querySelector(".rag-cancel") as HTMLButtonElement
  const progress = root.querySelector(".rag-progress") as HTMLElement
  const counts = root.querySelector(".rag-counts") as HTMLElement
  const log = root.querySelector(".rag-log") as HTMLOListElement
  const sourcesEl = root.querySelector(".rag-sources") as HTMLElement
  const hitsEl = root.querySelector(".rag-hits") as HTMLElement
  const stageNote = root.querySelector(".rag-stage-note") as HTMLElement
  const retrievalToggle = root.querySelector(
    ".rag-retrieval"
  ) as HTMLInputElement

  /* ---------------------------------------------------------------- widget */

  const config: WidgetConfig = {
    apiUrl,
    mode: "inline",
    position: "bottom-right",
    theme: "dark",
    trigger: "none",
    defaultOpen: true,
    tools: ["searchKnowledge"],
    tenantId: saved.tenantId,
  }

  let widget = mount(document.getElementById("host") as HTMLElement, config)

  /**
   * Remounts the widget against a different namespace.
   *
   * The tenant is read from config when the widget mounts, so unlike the tool
   * list it cannot be swapped in place. Remounting also clears the transcript,
   * which is right: answers from the previous knowledge base would sit above
   * answers from this one with nothing saying they came from different docs.
   */
  function remount(tenantId: string): void {
    widget.destroy()
    /*
     * A fresh element, not the same one emptied.
     *
     * `mount` calls `attachShadow`, which throws on a host that already has a
     * shadow root — and clearing `innerHTML` does not remove one, because the
     * shadow tree is not part of it. Replacing the node is the only way to get
     * a mountable host back.
     */
    const old = document.getElementById("host") as HTMLElement
    const host = document.createElement("div")
    host.id = "host"
    old.replaceWith(host)

    config.tenantId = tenantId
    widget = mount(host, config)
    applyRetrieval()
  }

  /*
   * Withholding the tool is enforced on the server — see `resolveTools` — so
   * turning retrieval off here is a real comparison, not a filter on what is
   * displayed. The model genuinely cannot call it.
   */
  function applyRetrieval(): void {
    /*
     * Written to `config` as well as pushed to the live widget.
     *
     * `setTools` reaches a handle React only publishes once it has rendered,
     * so a call made immediately after `mount` lands on nothing. The mounted
     * widget takes its initial list from `config` instead — which meant a
     * remount with retrieval switched off came back with it silently on, the
     * toggle still reading "off". Keeping both in step is what makes the
     * switch survive a namespace change.
     */
    config.tools = retrievalOn ? ["searchKnowledge"] : []
    widget.setTools(config.tools)
    stageNote.textContent = retrievalOn
      ? "answers from the indexed docs"
      : "answering from the model's own memory"
    stageNote.classList.toggle("rag-stage-note-off", !retrievalOn)
  }

  retrievalToggle.addEventListener("change", () => {
    retrievalOn = retrievalToggle.checked
    applyRetrieval()
  })
  applyRetrieval()

  /* --------------------------------------------------------------- sources */

  /**
   * Every namespace's indexed sites, not just the one in the form.
   *
   * `tenantId` omitted asks the server for all of them — see the doc comment
   * on `GET /rag/sources`. Scoping this to the current namespace would have
   * hidden exactly the thing worth seeing here: that a stale namespace name
   * left behind a knowledge base nobody points at any more, or that two
   * namespaces both indexed the same site by accident.
   */
  async function refreshSources(): Promise<void> {
    try {
      const response = await fetch(`${origin}/rag/sources`)
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as {
        sources: RagSource[]
        ingesting: boolean
      }
      renderSources(body.sources)
    } catch {
      sourcesEl.innerHTML = `<p class="rag-empty">
        Could not reach the server at <code>${esc(origin)}</code>.
        Is <code>bun dev</code> running?
      </p>`
    }
  }

  function renderSources(sources: RagSource[]): void {
    if (!sources.length) {
      sourcesEl.innerHTML = `<p class="rag-empty">
        Nothing indexed yet. The widget will say so rather than guessing.
      </p>`
      return
    }
    // Most recently touched first — that is almost always the one someone
    // just ingested and came here to check on.
    const ordered = [...sources].sort(
      (a, b) => b.lastIngestedAt - a.lastIngestedAt
    )
    sourcesEl.innerHTML = ordered
      .map((source) => {
        // The namespace the widget on this page is actually querying right
        // now — everything else here is indexed, but not what an answer
        // below would be grounded in.
        const active = source.tenantId === saved.tenantId
        return `<div class="rag-source${active ? " rag-source-active" : ""}">
          <div>
            <div class="rag-source-head">
              <strong>${esc(source.origin)}</strong>
              <code class="pg-chip${active ? "" : " pg-chip-plain"}"
                title="Namespace">${esc(source.tenantId)}</code>
            </div>
            <span class="rag-meta">
              ${source.pages} page${source.pages === 1 ? "" : "s"} ·
              ${source.chunks} chunk${source.chunks === 1 ? "" : "s"} ·
              ${ago(source.lastIngestedAt)}
            </span>
          </div>
          <button type="button" class="pg-delete rag-clear"
            data-tenant="${esc(source.tenantId)}">Clear</button>
        </div>`
      })
      .join("")
  }

  sourcesEl.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest(
      ".rag-clear"
    ) as HTMLButtonElement | null
    if (!button) return
    const tenantId = button.dataset.tenant!
    button.disabled = true
    try {
      await fetch(`${origin}/rag/clear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      })
    } finally {
      button.disabled = false
      hitsEl.innerHTML = ""
      await refreshSources()
    }
  })

  /* ---------------------------------------------------------------- ingest */

  /** One line in the crawl log. Kept terse — this list gets long. */
  function append(kind: string, text: string, detail = ""): void {
    const item = document.createElement("li")
    item.className = `rag-line rag-line-${kind}`
    item.innerHTML = `<span class="rag-tag">${esc(kind)}</span>
      <span class="rag-line-text">${esc(text)}</span>
      ${detail ? `<span class="rag-meta">${esc(detail)}</span>` : ""}`
    log.append(item)
    // Pinned to the newest line: during a crawl the interesting event is
    // always the one that just happened.
    log.scrollTop = log.scrollHeight
  }

  function setIngesting(active: boolean): void {
    ingesting = active
    goButton.disabled = active
    goButton.textContent = active ? "Ingesting…" : "Ingest"
    cancelButton.hidden = !active
    form.querySelectorAll("input").forEach((input) => {
      input.disabled = active
    })
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (ingesting) return

    const data = new FormData(form)
    const url = String(data.get("url") ?? "").trim()
    const tenantId = String(data.get("tenantId") ?? "").trim() || "playground"
    const maxPages = Number(data.get("maxPages") ?? 40)
    const prune = data.get("prune") === "on"

    const error = form.querySelector('[data-error="url"]') as HTMLElement
    try {
      // Validated here as well as on the server so the common mistake — a
      // bare hostname with no scheme — is named next to the field rather than
      // coming back as a generic 400.
      new URL(url)
      error.textContent = ""
    } catch {
      error.textContent = "Needs a full url, including https://"
      return
    }

    if (tenantId !== saved.tenantId) remount(tenantId)
    saved = { url, tenantId, maxPages }
    saveRagSource(saved)

    log.innerHTML = ""
    counts.textContent = ""
    progress.hidden = false
    setIngesting(true)
    ingestAbort = new AbortController()

    let pages = 0
    let chunks = 0
    let skipped = 0

    try {
      const response = await fetch(`${origin}/rag/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, tenantId, maxPages, prune }),
        signal: ingestAbort.signal,
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        append("error", body?.error ?? `server returned ${response.status}`)
        return
      }

      for await (const event of readEvents<IngestEvent>(
        response,
        ingestAbort.signal
      )) {
        switch (event.kind) {
          case "start":
            append("start", event.origin)
            break
          case "page":
            pages++
            chunks += event.chunks
            append("page", event.title || event.url, `${event.chunks} chunks`)
            break
          case "unchanged":
            append("same", event.url, "already indexed")
            break
          case "skip":
            skipped++
            append("skip", event.url, event.reason)
            break
          case "error":
            append("error", event.message)
            break
          case "done":
            counts.innerHTML = `
              <strong>${event.pages}</strong> pages ·
              <strong>${event.chunks}</strong> chunks ·
              ${event.unchanged} unchanged ·
              ${event.skipped} skipped${
                event.removed ? ` · ${event.removed} removed` : ""
              } ·
              ${(event.tokens ?? 0).toLocaleString()} tokens ·
              ${(event.ms / 1000).toFixed(1)}s`
            append("done", "finished")
            break
        }

        if (event.kind !== "done") {
          counts.innerHTML = `<strong>${pages}</strong> pages ·
            <strong>${chunks}</strong> chunks · ${skipped} skipped`
        }
      }
    } catch (cause) {
      // An abort is the Stop button working, not a failure.
      if (!ingestAbort?.signal.aborted) {
        append("error", cause instanceof Error ? cause.message : "ingest failed")
      }
    } finally {
      setIngesting(false)
      ingestAbort = null
      await refreshSources()
    }
  })

  cancelButton.addEventListener("click", () => {
    ingestAbort?.abort()
    // Told server-side too: aborting the fetch closes this end, but the crawl
    // is running in a generator that would otherwise finish the current page.
    fetch(`${origin}/rag/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: saved.tenantId }),
    }).catch(() => {})
    append("stopped", "cancelled")
  })

  /* ---------------------------------------------------------------- search */

  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    const query = String(new FormData(searchForm).get("query") ?? "").trim()
    if (!query) return

    hitsEl.innerHTML = `<p class="rag-empty">Searching…</p>`
    try {
      const response = await fetch(`${origin}/rag/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, tenantId: saved.tenantId, limit: 8 }),
      })
      if (!response.ok) throw new Error(String(response.status))
      const { hits } = (await response.json()) as { hits: RagHit[] }
      renderHits(hits)
    } catch {
      hitsEl.innerHTML = `<p class="rag-empty">Search failed.</p>`
    }
  })

  function renderHits(hits: RagHit[]): void {
    if (!hits.length) {
      hitsEl.innerHTML = `<p class="rag-empty">
        No passage matched. The widget will say the docs do not cover it
        rather than filling the gap from memory — that is the intended
        behaviour, not a bug.
      </p>`
      return
    }
    hitsEl.innerHTML = hits
      .map((hit) => {
        const crumb = [hit.title, ...hit.headings].filter(Boolean).join(" › ")
        /*
         * "both" is the interesting badge. A passage found by the vector side
         * and the keyword side independently is one you can trust; one found
         * by keywords alone is usually a literal string match, and by vectors
         * alone usually a paraphrase.
         */
        const via = hit.via.length > 1 ? "both" : hit.via[0]!
        return `<article class="rag-hit">
          <header>
            <span class="rag-crumb">${esc(crumb)}</span>
            <span class="rag-badges">
              <code class="pg-chip pg-chip-plain">${esc(via)}</code>
              <code class="pg-chip">${hit.score.toFixed(3)}</code>
            </span>
          </header>
          ${
            hit.question
              ? `<p class="rag-question">${esc(hit.question)}</p>`
              : ""
          }
          <p class="rag-text">${esc(hit.text.slice(0, 320))}${
            hit.text.length > 320 ? "…" : ""
          }</p>
          <a class="rag-url" href="${esc(hit.url)}" target="_blank"
            rel="noreferrer">${esc(hit.url)}</a>
        </article>`
      })
      .join("")
  }

  void refreshSources()
}
