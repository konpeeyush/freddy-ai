/**
 * Tool playground.
 *
 * Toggle which tools reach the model, then talk to it and watch what fires.
 * The list is fetched from the server's `/tools` rather than hardcoded, so
 * adding a tool to the registry makes it appear here with no matching edit.
 *
 * The toggle is enforced server-side — a tool absent from the request is
 * never passed upstream — so withholding one is a real test of whether the
 * model reaches for a rival, not a cosmetic filter on the response.
 *
 * Layout: the tool list scrolls, the widget does not. The two panes are read
 * together, so a widget that scrolled away while you worked down the list
 * would defeat the point of showing them side by side.
 *
 * Each tool is a collapsed `<details>` — the list is scanned to find a tool,
 * and five open cards push the fifth off screen. The checkbox sits in the
 * `<summary>` rather than the body so toggling stays one click whether or not
 * the row is expanded, which is why its click handler has to stop the
 * disclosure from opening along with it.
 *
 * Dev-only. Nothing here reaches widget.js.
 */

import { mount } from "../src/mount"
import { serverOrigin } from "./server-origin"
import { activeTenantId } from "./rag-source"
import { escapeHtml } from "./html-escape"
import type { WidgetConfig } from "../src/lib/config"
import {
  isOverridden,
  loadOverrides,
  saveOverrides,
  withOverride,
  type Overrides,
} from "./overrides"
import {
  drift,
  fingerprint,
  registerTool,
  unregisterTool,
} from "../src/tools/registry"
import { DEV_TOOLS, type DevTool, type DevToolMeta as ToolMeta } from "./tools"
import { saveLead } from "./tools/lead"
import { onWidgetAction } from "@workspace/widgets"
import { DEV_SEQUENCES } from "./sequences"
import {
  isSequenceOverridden,
  loadSequenceOverrides,
  saveSequenceOverrides,
  validateSteps,
  withSequenceOverride,
  type SequenceOverrides,
} from "./sequence-overrides"
import type { DraftedTool } from "@workspace/api"
import {
  activeFragment,
  brokenIn,
  EMPTY_SEQUENCE,
  insertMention,
  loadSequences,
  mentionsIn,
  saveSequences,
  unknownMentions,
  type SequenceDraft,
} from "./sequence-source"
import {
  onSequence,
  registerSequence,
  unregisterSequence,
} from "../src/tools/sequences"
import type {
  CompiledSequence,
  Sequence,
  SequenceStep,
} from "@workspace/api"
import {
  EMPTY_DRAFT,
  isValid,
  loadDrafts,
  saveDrafts,
  toDevTool,
  validate,
  WIDGET_IDS,
  type CustomToolDraft,
  type DraftErrors,
} from "./custom-tools"

/** Survives reloads — a toggle you set is usually one you want to keep. */
const STORAGE_KEY = "widget-playground-tools"

function loadEnabled(tools: ToolMeta[]): Set<string> {
  const known = new Set(tools.map((t) => t.name))
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as unknown
      if (Array.isArray(saved)) {
        // Drop names the server no longer knows: the playground and the
        // server can be at different versions, and a stale entry should not
        // quietly withhold a tool that exists.
        const enabled = new Set(
          saved.filter((n): n is string => known.has(n as string))
        )
        /*
         * A tool added since the list was saved is enabled, not withheld.
         *
         * Without this a stored list silently pins the playground to the
         * tools that existed when it was written: shipping `findPlaces`
         * left every existing session with a travel flow marked "broken —
         * not in context", which reads as a bug in sequences rather than a
         * stale preference. Only tools that ship enabled are added, so
         * deliberately unchecking one still sticks.
         */
        const seen = new Set(saved as string[])
        for (const tool of tools) {
          if (tool.defaultEnabled && !seen.has(tool.name)) enabled.add(tool.name)
        }
        return enabled
      }
    }
  } catch {
    // A corrupt entry is not worth failing the page over.
  }
  return new Set(tools.filter((t) => t.defaultEnabled).map((t) => t.name))
}

function saveEnabled(enabled: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabled]))
  } catch {
    // Private browsing. The toggles still work for this session.
  }
}

/*
 * One row in the tool list. Stock and custom render identically.
 *
 * `esc` here and `escapeHtml` below the sequence-editing code were two
 * identical copies of the same escaping function, plus a third in `rag.ts` —
 * now the one import from `./html-escape`. `esc` stays as a short alias
 * since most call sites in this file were already written against that name.
 */
const esc = escapeHtml

/*
 * One editable step.
 *
 * Structured rather than a text box. The rules that keep a flow runnable —
 * a tool that exists, a field written before it is read — belong to the
 * compiler, and re-parsing prose in the browser would mean owning them twice.
 * Typed controls mean the same rules can be checked against the live tool
 * registry, which text never could.
 *
 * A tool step offers only registered tools, so the misspelling the @ picker
 * exists to prevent cannot be reintroduced by hand here either.
 */
function stepEditor(
  step: SequenceStep,
  position: number,
  available: string[]
): string {
  const move = `
    <div class="pg-step-move">
      <button type="button" data-move-step="${position}" data-dir="-1"
        aria-label="Move step ${position + 1} earlier">↑</button>
      <button type="button" data-move-step="${position}" data-dir="1"
        aria-label="Move step ${position + 1} later">↓</button>
      <button type="button" class="pg-step-drop" data-drop-step="${position}"
        aria-label="Remove step ${position + 1}">×</button>
    </div>`

  if (step.kind === "ask") {
    return `<li class="pg-step" data-step="${position}" data-kind="ask">
      <div class="pg-step-head">
        <code class="pg-chip pg-chip-plain">ask</code>
        ${move}
      </div>
      <label>
        <span>Field</span>
        <input data-field="field" value="${escapeHtml(step.field)}"
          placeholder="orderNumber" autocomplete="off" />
        <small>Later steps read it as <code>$${escapeHtml(step.field || "field")}</code>.</small>
      </label>
      <label>
        <span>Ask for</span>
        <input data-field="prompt" value="${escapeHtml(step.prompt)}"
          placeholder="their order number" autocomplete="off" />
      </label>
    </li>`
  }

  /*
   * Pinned arguments are edited as `name=$field` lines — one per line rather
   * than JSON, because the thing being written is a short mapping and a JSON
   * box invites a syntax error over a two-word edit.
   */
  const pinned = Object.entries(step.inputFrom ?? {})
    .map(([argument, reference]) => `${argument}=${reference}`)
    .join("\n")

  const options = available.length
    ? available
        .map(
          (name) =>
            `<option value="${escapeHtml(name)}"${
              name === step.tool ? " selected" : ""
            }>${escapeHtml(name)}</option>`
        )
        .join("")
    : `<option value="${escapeHtml(step.tool)}" selected>${escapeHtml(
        step.tool
      )}</option>`

  return `<li class="pg-step" data-step="${position}" data-kind="tool">
    <div class="pg-step-head">
      <code class="pg-chip">tool</code>
      ${move}
    </div>
    <label>
      <span>Tool</span>
      <select data-field="tool">
        ${options}
        ${
          available.includes(step.tool)
            ? ""
            : `<option value="${escapeHtml(step.tool)}" selected>${escapeHtml(
                step.tool
              )} — not registered</option>`
        }
      </select>
    </label>
    <label>
      <span>Pinned arguments</span>
      <textarea data-field="inputFrom" rows="2" spellcheck="false"
        placeholder="city=$destination">${escapeHtml(pinned)}</textarea>
      <small>
        One per line. Anything not pinned here the model fills from the
        conversation.
      </small>
    </label>
  </li>`
}

function toolRow(
  tool: ToolMeta,
  enabled: Set<string>,
  custom: boolean,
  editable?: { description: string; schemaText: string; overridden: boolean }
): string {
  const example = tool.example.replace(/"/g, "&quot;")
  return `
    <li>
      <details class="pg-tool">
        <summary>
          <span class="pg-caret" aria-hidden="true">▸</span>
          <span class="pg-tool-name">
            ${tool.label}
            ${
              tool.widget
                ? `<code class="pg-chip">${tool.widget}</code>`
                : `<code class="pg-chip pg-chip-plain">text</code>`
            }
            ${custom ? `<code class="pg-chip pg-chip-custom">yours</code>` : ""}
            ${
              editable?.overridden
                ? `<code class="pg-chip pg-chip-edited">edited</code>`
                : ""
            }
          </span>
          <input
            type="checkbox"
            data-tool="${tool.name}"
            aria-label="Enable ${tool.label}"
            ${enabled.has(tool.name) ? "checked" : ""}
          />
        </summary>
        <div class="pg-tool-detail">
          <p class="pg-tool-summary">${tool.summary}</p>
          <button type="button" class="pg-try" data-example="${example}">
            ${custom ? "Copy the description" : `Try “${tool.example}”`}
          </button>
          ${
            custom
              ? `<button type="button" class="pg-delete" data-delete="${tool.name}">Delete</button>`
              : ""
          }
        </div>
        ${
          editable
            ? `<form class="pg-edit" data-edit="${tool.name}">
                <label>
                  <span>Description</span>
                  <textarea name="description" rows="4">${esc(editable.description)}</textarea>
                  <small>What the model reads to decide whether to call it.</small>
                </label>
                <label>
                  <span>Arguments — JSON Schema</span>
                  <textarea name="schemaText" rows="7" spellcheck="false">${esc(editable.schemaText)}</textarea>
                  <em data-edit-error></em>
                </label>
                <div class="pg-edit-actions">
                  <button type="submit">Apply</button>
                  <button type="button" class="pg-secondary" data-revert="${tool.name}"
                    ${editable.overridden ? "" : "disabled"}>Revert</button>
                </div>
                <small class="pg-edit-note">
                  The handler is the shipped one — this edits what the model is
                  told, not what the tool does.
                </small>
              </form>`
            : ""
        }
      </details>
    </li>`
}

export async function renderPlayground(
  root: HTMLElement,
  chrome: (body: string) => string,
  apiUrl: string
): Promise<void> {
  /*
   * The tool list is local now.
   *
   * These are client-side tools: the page defines them and the page runs
   * them, so there is nothing to ask the server for. Toggling one registers
   * or unregisters it, which is exactly what a customer's page does.
   */
  /*
   * Custom tools sit alongside the stock ones and behave identically — same
   * registry, same toggle, same request. A tool you wrote here is not a
   * lesser thing than one shipped in `dev/tools/`.
   */
  let drafts: CustomToolDraft[] = loadDrafts()
  let custom: DevTool[] = drafts.map(toDevTool)

  /*
   * Edits to the shipped tools. Applied at registration rather than written
   * back to `dev/tools/*.ts`, so the authored definition stays the reference
   * and reverting is instant.
   */
  let overrides: Overrides = loadOverrides()

  const stock = (): DevTool[] => DEV_TOOLS.map((t) => withOverride(t, overrides))
  const allTools = (): DevTool[] => [...stock(), ...custom]
  let tools: ToolMeta[] = allTools().map((t) => t.meta)

  /** The editor's current contents for one shipped tool. */
  const editableFor = (tool: DevTool) => ({
    description: tool.definition.description,
    schemaText: JSON.stringify(tool.definition.inputSchema ?? {}, null, 2),
    overridden: isOverridden(tool.meta.name, overrides),
  })
  const enabled = loadEnabled(tools)

  root.innerHTML = chrome(
    `<div class="pg">
      <aside class="pg-panel">
        <div class="pg-head">
          <p class="eyebrow">Playground</p>
          <h1>Tools in context</h1>
          <p class="lede small">
            Only what is checked reaches the model. Enforced on the server, so
            a tool you turn off cannot be called however it is asked for.
          </p>
        </div>

        <ul class="pg-tools">
          ${stock().map((t) => toolRow(t.meta, enabled, false, editableFor(t))).join("")}
          ${custom.map((t) => toolRow(t.meta, enabled, true)).join("")}
        </ul>

        <details class="pg-new">
          <summary>
            <span class="pg-caret" aria-hidden="true">▸</span>
            New tool
          </summary>
          <form class="pg-form" novalidate>
            <div class="pg-draft">
              <label>
                <span>Describe it</span>
                <textarea name="intent" rows="2"
                  placeholder="look up how many loyalty points the customer has"></textarea>
              </label>
              <button type="button" class="pg-draft-go">Draft with AI</button>
              <p class="pg-draft-status" role="status"></p>
            </div>

            <label>
              <span>Name</span>
              <input name="name" placeholder="getCartTotal" autocomplete="off" />
              <em data-error="name"></em>
            </label>

            <label>
              <span>Description</span>
              <textarea name="description" rows="3"
                placeholder="What it does, and when the model should reach for it."></textarea>
              <em data-error="description"></em>
              <small>This is what decides whether the tool ever fires.</small>
            </label>

            <label>
              <span>Arguments — JSON Schema</span>
              <textarea name="schemaText" rows="6" spellcheck="false"></textarea>
              <em data-error="schemaText"></em>
            </label>

            <fieldset class="pg-radios">
              <legend>Returns</legend>
              <label class="pg-radio">
                <input type="radio" name="returnKind" value="json" checked />
                <span>JSON</span>
              </label>
              <label class="pg-radio">
                <input type="radio" name="returnKind" value="widget" />
                <span>A widget</span>
              </label>
            </fieldset>

            <label data-when="widget" hidden>
              <span>Widget</span>
              <select name="widgetId">
                ${WIDGET_IDS.map((id) => `<option value="${id}">${id}</option>`).join("")}
              </select>
              <em data-error="widgetId"></em>
            </label>

            <label>
              <span data-label-for="returnText">Result</span>
              <textarea name="returnText" rows="5" spellcheck="false"></textarea>
              <em data-error="returnText"></em>
              <small>Arguments the model sent are echoed back alongside it.</small>
            </label>

            <label data-when="widget" hidden>
              <span>Summary</span>
              <textarea name="summary" rows="2"
                placeholder="Showed the visitor their cart total."></textarea>
              <em data-error="summary"></em>
              <small>The model reads this instead of the widget's data.</small>
            </label>

            <div class="pg-form-actions">
              <button type="submit">Add tool</button>
              <button type="reset" class="pg-secondary">Clear</button>
            </div>
          </form>
        </details>

        <div class="pg-head pg-head-seq">
          <h2>Sequences</h2>
          <p class="lede small">
            A sequence pins the order of a flow. While one runs, only the step
            it is on is sent upstream — a later tool is absent from the
            model's context, not merely discouraged.
          </p>
        </div>

        <ul class="pg-seq-list"></ul>

        <details class="pg-new pg-seq-new-panel">
          <summary>
            <span class="pg-caret" aria-hidden="true">▸</span>
            New sequence
          </summary>
          <div class="pg-seq-new">
            <label>
              <span>Describe the flow</span>
              <textarea class="pg-seq-source" rows="3"
                placeholder="when someone asks about a refund, get their order number, then @lookupOrder and then @startRefund"></textarea>
              <small>Type <kbd>@</kbd> to reference a tool.</small>
            </label>
            <div class="pg-seq-picker" hidden></div>
            <button type="button" class="pg-seq-go">Compile</button>
            <p class="pg-seq-status" role="status"></p>
            <div class="pg-seq-preview" hidden></div>
          </div>
        </details>

        <p class="pg-count"></p>
        <p class="pg-drift"></p>
      </aside>

      <div class="pg-stage">
        <div id="host"></div>
      </div>
    </div>`
  )

  const host = document.getElementById("host") as HTMLElement

  const config: WidgetConfig = {
    apiUrl,
    mode: "inline",
    position: "bottom-right",
    theme: "dark",
    trigger: "none",
    defaultOpen: true,
    /*
     * Left undefined so the server applies its own defaults.
     *
     * The toggle list below is client-side — those go up as `clientTools`, a
     * different field — so this one only ever narrowed the server's own set.
     * An empty array is not the same as omitting it: the server reads `[]` as
     * "no server tools at all" and deliberately does not fall back, which
     * withheld `searchKnowledge` here permanently. Docs ingested on `/rag`
     * were then invisible on this page, and the model answered from memory.
     */
    tenantId: activeTenantId(),
  }

  mount(host, config)

  /*
   * Flow lifecycle, logged.
   *
   * The playground's stand-in for what a host page does with these — a real
   * one posts the `end` event's `captured` to a CRM. Logged rather than
   * rendered because the useful thing while building a flow is watching the
   * order events arrive in, next to the conversation producing them.
   */
  onSequence((event) => {
    if (event.kind === "end") {
      console.log(
        `[sequence] ${event.label} ${event.reason} ` +
          `(${event.reached}/${event.steps})`,
        event.captured
      )
      return
    }
    if (event.kind === "start") {
      console.log(`[sequence] ${event.label} started — ${event.steps} steps`)
      return
    }
    console.log(
      `[sequence] ${event.label} step ${event.step}/${event.steps}: ` +
        (event.field ? `${event.field} = ${String(event.value)}` : event.tool)
    )
  })

  /*
   * Where a submitted lead goes.
   *
   * This is the seam a customer implements — swapping the store below for a
   * POST to their CRM is the whole of the real integration. It lives on the
   * host page rather than in the tool's handler because that is the actual
   * split: the tool decides *when* to ask, the page decides where the answer
   * goes, and neither needs to know about the other.
   *
   * Returning data replaces the widget's own, which is what moves the form to
   * its `done` state — a form that stayed a form would invite a second
   * submit, and the model cannot tell the two apart in history.
   */
  /*
   * Picking a stay.
   *
   * Returning data replaces the widget's own, which moves the list to its
   * chosen state — the same mechanism the lead form uses, and the reason a
   * choice made three turns ago still reads as made when the panel reopens.
   */
  onWidgetAction((event) => {
    if (event.functionName !== "chooseStay") return

    const values = (event.payload ?? {}) as Record<string, unknown>
    const name = typeof values.name === "string" ? values.name : "That one"
    const price = typeof values.price === "string" ? values.price : undefined

    return {
      picked: true,
      chosen: name,
      chosenNote: price
        ? `Noted — ${price} a night. A real integration would hold it here.`
        : "Noted. A real integration would hold it here.",
    }
  })

  onWidgetAction((event) => {
    if (event.functionName !== "submitLead") return

    const values = (event.payload ?? {}) as Record<string, unknown>
    const text = (key: string) =>
      typeof values[key] === "string" && (values[key] as string).trim()
        ? (values[key] as string).trim()
        : undefined

    saveLead({
      name: text("name"),
      email: text("email"),
      phone: text("phone"),
      topic: text("topic"),
      at: new Date().toISOString(),
    })

    const email = text("email")
    return {
      submitted: true,
      confirmation: email
        ? `We'll reply to ${email}.`
        : "We'll be in touch shortly.",
    }
  })

  /*
   * Applied in place, deliberately.
   *
   * Comparing how the model behaves with a tool withheld means asking the
   * *same* question again — which needs the conversation that question is
   * already in. Remounting on every toggle would throw away the transcript
   * being used to make the comparison, which is the opposite of useful.
   *
   * Only the next request changes; anything already on screen stays.
   */
  const applyTools = () => {
    /*
     * Registering is the toggle. A client tool exists because it is in the
     * registry when the request is built — there is no server-side list to
     * filter, so withholding one means taking it back out.
     */
    for (const { definition, meta } of allTools()) {
      if (enabled.has(meta.name)) registerTool(definition)
      else unregisterTool(meta.name)
    }

    /*
     * Sequences are re-rendered here rather than at each toggle, because this
     * is the one place the tool set actually changes — and a flow's "needs a
     * tool that is not in context" warning is only true relative to that set.
     * Withholding `getWeather` has to show the travel flow as broken
     * immediately, or the warning is stale exactly when it matters.
     */
    renderSequences()
  }

  // Register the initial set before the first message can be sent. Deferred
  // to just after the sequence panel is wired, since `applyTools` now renders
  // it — see `applySequences` below.


  /*
   * What the model was told last turn, so a change can be named.
   *
   * Toggling mid-conversation is the whole workflow here, and its effect is
   * otherwise invisible: a transcript looks the same whether a tool was
   * withheld or simply not chosen. Naming what moved turns "it stopped
   * firing" into something with a cause.
   */
  let lastFingerprint = fingerprint()

  const reportDrift = () => {
    const current = fingerprint()
    const { added, removed, changed } = drift(current, lastFingerprint)
    lastFingerprint = current

    const slot = root.querySelector(".pg-drift") as HTMLElement | null
    if (!slot) return

    const parts = [
      added.length ? `+${added.join(", ")}` : "",
      removed.length ? `−${removed.join(", ")}` : "",
      changed.length ? `~${changed.join(", ")}` : "",
    ].filter(Boolean)

    slot.textContent = parts.length ? `Next turn: ${parts.join("  ")}` : ""
  }

  const count = root.querySelector(".pg-count") as HTMLElement
  const updateCount = () => {
    const n = enabled.size
    count.textContent =
      n === 0
        ? "No tools — the model can only answer in prose."
        : `${n} of ${tools.length} tools in context.`
  }
  updateCount()

  const list = root.querySelector(".pg-tools") as HTMLElement

  function persistCustom(): void {
    custom = drafts.map(toDevTool)
    tools = allTools().map((t) => t.meta)
    saveDrafts(drafts)
  }

  function persistOverrides(): void {
    tools = allTools().map((t) => t.meta)
    saveOverrides(overrides)
  }

  /** Rebuilds the list, re-binds it, and re-applies the registry. */
  function renderTools(): void {
    list.innerHTML =
      stock()
        .map((t) => toolRow(t.meta, enabled, false, editableFor(t)))
        .join("") +
      custom.map((t) => toolRow(t.meta, enabled, true)).join("")
    wireRows()
    updateCount()
    applyTools()
  }

  /*
   * Re-bound after every list re-render.
   *
   * The rows are rebuilt from markup when a tool is added or deleted, which
   * discards their listeners along with the old nodes.
   */
  function wireRows(): void {
    root.querySelectorAll<HTMLInputElement>("input[data-tool]").forEach((box) => {
    /*
     * A click anywhere in a <summary> toggles the disclosure, so without this
     * checking a tool would also expand it. Stopped on click rather than on
     * change: the browser opens the details on the click, before change ever
     * fires.
     */
    box.addEventListener("click", (event) => event.stopPropagation())

      box.addEventListener("change", () => {
        const name = box.dataset.tool as string
        if (box.checked) enabled.add(name)
        else enabled.delete(name)
        saveEnabled(enabled)
        updateCount()
        applyTools()
        reportDrift()
      })
    })

    /*
     * Editing a shipped tool.
     *
     * Applied to the next request, not to what is on screen — the point of
     * editing a description is to ask the same question again and see whether
     * the tool fires this time, which needs the conversation intact.
     */
    root.querySelectorAll<HTMLFormElement>("form[data-edit]").forEach((form) => {
      const name = form.dataset.edit as string
      const errorSlot = form.querySelector("[data-edit-error]") as HTMLElement

      form.addEventListener("submit", (event) => {
        event.preventDefault()

        const description = (
          form.querySelector('[name="description"]') as HTMLTextAreaElement
        ).value.trim()
        const schemaText = (
          form.querySelector('[name="schemaText"]') as HTMLTextAreaElement
        ).value

        if (!description) {
          errorSlot.textContent = "A tool with no description will not fire."
          return
        }

        let inputSchema: Record<string, unknown> | undefined
        try {
          const parsed = JSON.parse(schemaText) as unknown
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            errorSlot.textContent = "Must be a JSON Schema object."
            return
          }
          if ((parsed as { type?: string }).type !== "object") {
            // Providers expect a top-level object for function parameters.
            errorSlot.textContent = `Top-level "type" must be "object".`
            return
          }
          inputSchema = parsed as Record<string, unknown>
        } catch (cause) {
          errorSlot.textContent =
            cause instanceof Error ? cause.message : "invalid JSON"
          return
        }

        errorSlot.textContent = ""
        overrides = { ...overrides, [name]: { description, inputSchema } }
        persistOverrides()
        renderTools()
      })
    })

    root
      .querySelectorAll<HTMLButtonElement>("button[data-revert]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.dataset.revert as string
          // Dropping the entry is the revert: the shipped definition is what
          // registers when nothing is stored.
          const next = { ...overrides }
          delete next[name]
          overrides = next
          persistOverrides()
          renderTools()
        })
      })

    root
      .querySelectorAll<HTMLButtonElement>("button[data-delete]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.dataset.delete as string
          // Unregister before forgetting it, or it stays in the model's
          // context until something else happens to re-apply the list.
          unregisterTool(name)
          enabled.delete(name)
          drafts = drafts.filter((d) => d.name.trim() !== name)
          persistCustom()
          renderTools()
        })
      })
  }

  // The rows rendered with the page still need their listeners.
  wireRows()

  /*
   * The example chips copy the prompt rather than typing it in.
   *
   * The shadow root is `closed`, so the harness genuinely cannot reach the
   * composer's textarea — which is the isolation guarantee working, not an
   * obstacle to route around. Copying keeps the prompt editable, which is
   * the point: vary one word and see whether the tool still fires.
   */
  /*
   * Bound per-element rather than once over the panel, because the sequence
   * rows re-render whenever the tool set changes — a listener attached to the
   * old nodes would be lost with them.
   */
  function wireExamples(scope: ParentNode): void {
    scope
      .querySelectorAll<HTMLButtonElement>("button[data-example]")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const prompt = btn.dataset.example ?? ""
          const original = btn.textContent
          try {
            await navigator.clipboard.writeText(prompt)
            btn.textContent = "Copied — paste it in"
          } catch {
            // Clipboard needs a secure context and can still be refused.
            btn.textContent = prompt
            btn.classList.add("pg-try-bare")
          }
          setTimeout(() => {
            btn.textContent = original
            btn.classList.remove("pg-try-bare")
          }, 1800)
        })
      })
  }

  wireExamples(root)

  /*
   * The tool builder.
   *
   * A handler here returns something you typed rather than doing real work —
   * what is under test is the description and the schema, which is what
   * decides whether the model calls the tool and with what. The arguments it
   * sent are echoed into the result so that is visible in the transcript.
   */
  const form = root.querySelector(".pg-form") as HTMLFormElement
  const newPanel = root.querySelector(".pg-new") as HTMLDetailsElement

  const field = <T extends HTMLElement>(name: string) =>
    form.querySelector<T>(`[name="${name}"]`) as T

  /** Reads the form into a draft. */
  const readDraft = (): CustomToolDraft => ({
    name: field<HTMLInputElement>("name").value,
    description: field<HTMLTextAreaElement>("description").value,
    schemaText: field<HTMLTextAreaElement>("schemaText").value,
    returnKind:
      (form.querySelector<HTMLInputElement>('[name="returnKind"]:checked')
        ?.value as CustomToolDraft["returnKind"]) ?? "json",
    returnText: field<HTMLTextAreaElement>("returnText").value,
    widgetId: field<HTMLSelectElement>("widgetId").value,
    summary: field<HTMLTextAreaElement>("summary").value,
  })

  const showErrors = (errors: DraftErrors): void => {
    form.querySelectorAll<HTMLElement>("[data-error]").forEach((slot) => {
      const key = slot.dataset.error as keyof DraftErrors
      slot.textContent = errors[key] ?? ""
      slot.parentElement?.classList.toggle("has-error", Boolean(errors[key]))
    })
  }

  /** Widget-only fields appear only when a widget is what it returns. */
  const syncReturnKind = (): void => {
    const isWidget = readDraft().returnKind === "widget"
    form
      .querySelectorAll<HTMLElement>('[data-when="widget"]')
      .forEach((el) => (el.hidden = !isWidget))
    const label = form.querySelector<HTMLElement>('[data-label-for="returnText"]')
    if (label) label.textContent = isWidget ? "Widget data" : "Result"
  }

  const resetForm = (): void => {
    field<HTMLInputElement>("name").value = EMPTY_DRAFT.name
    field<HTMLTextAreaElement>("description").value = EMPTY_DRAFT.description
    field<HTMLTextAreaElement>("schemaText").value = EMPTY_DRAFT.schemaText
    field<HTMLTextAreaElement>("returnText").value = EMPTY_DRAFT.returnText
    field<HTMLTextAreaElement>("summary").value = EMPTY_DRAFT.summary
    field<HTMLSelectElement>("widgetId").value = EMPTY_DRAFT.widgetId
    const json = form.querySelector<HTMLInputElement>('[value="json"]')
    if (json) json.checked = true
    const intentField = form.querySelector<HTMLTextAreaElement>('[name="intent"]')
    if (intentField) intentField.value = ""
    const status = root.querySelector(".pg-draft-status")
    if (status) {
      status.textContent = ""
      status.classList.remove("is-error")
    }
    showErrors({})
    syncReturnKind()
  }

  resetForm()

  form
    .querySelectorAll<HTMLInputElement>('[name="returnKind"]')
    .forEach((radio) => radio.addEventListener("change", syncReturnKind))

  form.addEventListener("reset", () => {
    // Defer: the browser clears the fields after this event, which would
    // otherwise wipe the defaults we just restored.
    setTimeout(resetForm)
  })

  /*
   * Drafting.
   *
   * The schema and the description are the two fields people get wrong, and
   * both are things the model writes well. What comes back lands in the form
   * as an editable draft rather than being registered directly — it is a
   * starting point to correct, not an answer to accept.
   */
  /*
   * Sequences.
   *
   * Authored as prose with `@tool` mentions, compiled server-side into
   * ordered steps, then registered. The compiled form is shown before it is
   * registered rather than after — the compiler has to guess at things the
   * prose leaves open (which captured answer feeds which argument, most
   * often), and a wrong guess is invisible once the flow is live.
   */
  /*
   * Authored flows, from storage. The shipped ones are not in here: they come
   * from the module on every load, so editing `sequences.ts` shows up without
   * anyone having to clear their storage first — the same bargain `DEV_TOOLS`
   * makes.
   */
  let sequences: SequenceDraft[] = loadSequences()

  /** Edited triggers, layered over the shipped flows. See `./sequence-overrides`. */
  let seqOverrides: SequenceOverrides = loadSequenceOverrides()

  /** Shipped and authored together, for display and registration. */
  const allSequences = (): {
    sequence: Sequence
    shipped: boolean
    example: string
  }[] => [
    ...DEV_SEQUENCES.map(({ sequence, example }) => ({
      sequence: withSequenceOverride(sequence, seqOverrides),
      shipped: true,
      example,
    })),
    ...sequences
      .filter((draft): draft is SequenceDraft & { compiled: Sequence } =>
        Boolean(draft.compiled)
      )
      .map((draft) => ({
        sequence: draft.compiled,
        shipped: false,
        // An authored flow has no hand-written example, so the prose it was
        // compiled from is the closest thing to one.
        example: draft.source,
      })),
  ]

  const seqSource = root.querySelector(".pg-seq-source") as HTMLTextAreaElement
  const seqPicker = root.querySelector(".pg-seq-picker") as HTMLElement
  const seqStatus = root.querySelector(".pg-seq-status") as HTMLElement
  const seqPreview = root.querySelector(".pg-seq-preview") as HTMLElement
  const seqList = root.querySelector(".pg-seq-list") as HTMLElement
  const seqGo = root.querySelector(".pg-seq-go") as HTMLButtonElement

  /** Only tools currently in context — a flow cannot reach a withheld one. */
  const availableTools = (): string[] =>
    tools.map((t) => t.name).filter((name) => enabled.has(name))

  /** Registers every compiled flow, so the widget can run them. */
  function applySequences(): void {
    for (const { sequence } of allSequences()) registerSequence(sequence)
  }

  function renderSequences(): void {
    const available = availableTools()
    const entries = allSequences()

    /*
     * Which rows were open, so re-rendering does not close them.
     *
     * This list re-renders on every tool toggle — a flow's "needs a tool not
     * in context" warning is only true relative to the current set — so a row
     * that collapsed each time would make reading a flow while toggling
     * tools, which is the actual workflow, impossible.
     */
    const wasOpen = new Set(
      [...seqList.querySelectorAll<HTMLDetailsElement>("details[data-seq-id]")]
        .filter((row) => row.open)
        .map((row) => row.dataset.seqId as string)
    )

    seqList.innerHTML =
      entries.length === 0
        ? `<li class="pg-seq-empty">No sequences yet.</li>`
        : entries
            .map(({ sequence, shipped, example }, index) => {
              /*
               * A flow whose tool has since been withheld is shown as broken
               * here rather than failing mid-conversation. This is the reason
               * mentions are stored as ids and re-checked, instead of living
               * only as text in the prose.
               */
              const broken = brokenIn(sequence, available)
              const steps = sequence.steps
                .map((step) =>
                  step.kind === "ask"
                    ? `<li class="is-ask">ask <em>${escapeHtml(step.field)}</em>` +
                      ` — ${escapeHtml(step.prompt)}</li>`
                    : `<li${broken.includes(step.tool) ? ' class="is-broken"' : ""}>` +
                      `${escapeHtml(step.tool)}${
                        step.inputFrom
                          ? ` <em>${escapeHtml(
                              Object.entries(step.inputFrom)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")
                            )}</em>`
                          : ""
                      }</li>`
                )
                .join("")

              /*
               * Same disclosure shape as a tool row: the list is scanned to
               * find a flow, and the steps only matter once you have.
               */
              return `<li>
                <details class="pg-tool pg-seq-row" data-seq-id="${escapeHtml(
                  sequence.id
                )}"${wasOpen.has(sequence.id) ? " open" : ""}>
                  <summary>
                    <span class="pg-caret" aria-hidden="true">▸</span>
                    <span class="pg-tool-name">
                      ${escapeHtml(sequence.label)}
                      <code class="pg-chip">${sequence.steps.length} steps</code>
                      ${
                        shipped
                          ? ""
                          : `<code class="pg-chip pg-chip-custom">yours</code>`
                      }
                      ${
                        isSequenceOverridden(sequence.id, seqOverrides)
                          ? `<code class="pg-chip pg-chip-edited">edited</code>`
                          : ""
                      }
                      ${
                        broken.length
                          ? `<code class="pg-chip pg-chip-broken">broken</code>`
                          : ""
                      }
                    </span>
                  </summary>
                  <div class="pg-tool-detail">
                    <ol class="pg-seq-steps">${steps}</ol>
                    ${
                      broken.length
                        ? `<p class="pg-seq-broken">Needs ${escapeHtml(
                            broken.join(", ")
                          )} — not in context, so this flow will not start.</p>`
                        : ""
                    }
                    <button type="button" class="pg-try" data-example="${escapeHtml(
                      example
                    )}">Try “${escapeHtml(example)}”</button>
                    ${
                      shipped
                        ? ""
                        : `<button type="button" class="pg-delete" data-remove-seq="${index}">Delete</button>`
                    }
                  </div>

                  <form class="pg-edit" data-edit-seq="${escapeHtml(sequence.id)}">
                    <label>
                      <span>Trigger</span>
                      <textarea name="trigger" rows="4">${escapeHtml(
                        sequence.trigger
                      )}</textarea>
                      <small>What the model reads to decide whether to start this flow.</small>
                    </label>

                    <div class="pg-steps">
                      <span class="pg-steps-label">Steps</span>
                      <ol class="pg-steps-list">
                        ${sequence.steps
                          .map((step, position) =>
                            stepEditor(step, position, available)
                          )
                          .join("")}
                      </ol>
                      <div class="pg-steps-add">
                        <button type="button" data-add-step="ask">+ Ask</button>
                        <button type="button" data-add-step="tool">+ Tool</button>
                      </div>
                      <em data-step-error></em>
                    </div>

                    <div class="pg-edit-actions">
                      <button type="submit">Apply</button>
                      <button type="button" class="pg-secondary" data-revert-seq="${escapeHtml(
                        sequence.id
                      )}" ${
                        isSequenceOverridden(sequence.id, seqOverrides)
                          ? ""
                          : "disabled"
                      }>Revert</button>
                    </div>
                    <small class="pg-edit-note">
                      Order is the content of a flow: a step that reads
                      <code>$field</code> has to sit after the ask that captures it.
                      Applying checks that before it stores anything.
                    </small>
                  </form>
                </details>
              </li>`
            })
            .join("")

    wireExamples(seqList)

    /*
     * The trigger editor.
     *
     * Edits are stored as overrides rather than written back to the source,
     * so the shipped flow stays the reference and reverting is instant —
     * exactly how a tool's description is handled next door.
     */
    seqList.querySelectorAll<HTMLFormElement>("[data-edit-seq]").forEach((form) => {
      const id = form.dataset.editSeq as string

      const problems = form.querySelector("[data-step-error]") as HTMLElement

      /*
       * The steps as currently typed, read back out of the DOM.
       *
       * The form is the source of truth between renders rather than a mirror
       * held in JS — an edit in progress lives in the inputs, and syncing a
       * copy on every keystroke would be a second place for it to disagree.
       */
      const readSteps = (): SequenceStep[] =>
        [...form.querySelectorAll<HTMLElement>(".pg-step")].map((row) => {
          const value = (name: string) =>
            row
              .querySelector<HTMLInputElement | HTMLTextAreaElement>(
                `[data-field="${name}"]`
              )
              ?.value.trim() ?? ""

          if (row.dataset.kind === "ask") {
            return {
              kind: "ask" as const,
              field: value("field"),
              prompt: value("prompt"),
            }
          }

          /*
           * `name=$field` per line. Malformed lines are dropped rather than
           * erroring: half a mapping typed mid-edit is not a mistake worth
           * blocking a save over, and an unpinned argument is filled from the
           * conversation, which is the safe fallback.
           */
          const inputFrom: Record<string, string> = {}
          for (const line of value("inputFrom").split("\n")) {
            const [argument, reference] = line.split("=")
            if (argument?.trim() && reference?.trim()) {
              inputFrom[argument.trim()] = reference.trim()
            }
          }

          return {
            kind: "tool" as const,
            tool: value("tool"),
            inputFrom: Object.keys(inputFrom).length ? inputFrom : undefined,
          }
        })

      /** Stores an edit, after checking it can actually run. */
      const applyEdit = (trigger: string, steps: SequenceStep[]): boolean => {
        /*
         * Checked against the tools in *context*, not merely those
         * registered: a step calling a withheld tool cannot run, and the
         * broken-flow warning on the row says exactly that.
         */
        const inContext = new Set(availableTools())
        const found = validateSteps(steps, (name) => inContext.has(name))
        problems.textContent = found.join(" ")
        if (found.length > 0) return false

        seqOverrides = { ...seqOverrides, [id]: { trigger, steps } }
        saveSequenceOverrides(seqOverrides)
        return true
      }

      /*
       * Structural edits save immediately rather than waiting for Apply.
       *
       * Re-rendering is what redraws the list in its new order, and rendering
       * from unsaved state would show an order that is not the one running.
       * Each of these keeps whatever is typed in the other fields.
       */
      const restructure = (next: (steps: SequenceStep[]) => SequenceStep[]) => {
        const trigger =
          form.querySelector<HTMLTextAreaElement>('[name="trigger"]')?.value.trim() ??
          ""
        if (!trigger) return
        if (applyEdit(trigger, next(readSteps()))) {
          applySequences()
          renderSequences()
        }
      }

      form.querySelectorAll<HTMLButtonElement>("[data-add-step]").forEach((button) => {
        button.addEventListener("click", () => {
          const kind = button.dataset.addStep
          restructure((steps) => [
            ...steps,
            kind === "ask"
              ? { kind: "ask", field: "", prompt: "" }
              : // The first registered tool, so a new step is valid the
                // moment it appears rather than failing validation at birth.
                { kind: "tool", tool: availableTools()[0] ?? "" },
          ])
        })
      })

      form.querySelectorAll<HTMLButtonElement>("[data-move-step]").forEach((button) => {
        button.addEventListener("click", () => {
          const from = Number(button.dataset.moveStep)
          const to = from + Number(button.dataset.dir)
          restructure((steps) => {
            if (to < 0 || to >= steps.length) return steps
            const next = [...steps]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
        })
      })

      form.querySelectorAll<HTMLButtonElement>("[data-drop-step]").forEach((button) => {
        button.addEventListener("click", () => {
          const at = Number(button.dataset.dropStep)
          restructure((steps) => steps.filter((_, i) => i !== at))
        })
      })

      form.addEventListener("submit", (event) => {
        event.preventDefault()
        const field = form.querySelector<HTMLTextAreaElement>('[name="trigger"]')
        const trigger = field?.value.trim()
        // A flow with no trigger can never start, so an empty one is refused
        // rather than stored — reverting is what "undo my edit" means here.
        if (!trigger) {
          problems.textContent = "A flow with no trigger can never start."
          return
        }

        if (!applyEdit(trigger, readSteps())) return
        /*
         * Not reported through `reportDrift`: that compares the page tool
         * map, which a sequence's entry point is not part of, so it would
         * report "nothing changed" over an edit that plainly did.
         */
        applySequences()
        renderSequences()
      })

      form
        .querySelector<HTMLButtonElement>("[data-revert-seq]")
        ?.addEventListener("click", () => {
          // Dropping the entry is the revert: the shipped trigger is what
          // registers when nothing is stored.
          const next = { ...seqOverrides }
          delete next[id]
          seqOverrides = next
          saveSequenceOverrides(seqOverrides)
          applySequences()
          renderSequences()
        })
    })

    seqList.querySelectorAll<HTMLButtonElement>("[data-remove-seq]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          // The row index counts shipped flows too, which are not removable
          // and not in `sequences` — so shift past them to find the draft.
          const index = Number(button.dataset.removeSeq) - DEV_SEQUENCES.length
          const removed = sequences[index]
          if (removed?.compiled) unregisterSequence(removed.compiled.id)
          sequences = sequences.filter((_, i) => i !== index)
          saveSequences(sequences)
          renderSequences()
        })
      }
    )
  }

  /*
   * The @ picker.
   *
   * Inserting from a list rather than letting names be typed is what keeps a
   * mention resolvable: `@curency` for `@currency` is the obvious typo, and
   * it would otherwise compile to a step calling a tool that does not exist.
   */
  function closePicker(): void {
    seqPicker.hidden = true
    seqPicker.innerHTML = ""
  }

  function showPicker(fragment: string): void {
    const matches = availableTools().filter((name) =>
      name.toLowerCase().includes(fragment.toLowerCase())
    )

    if (matches.length === 0) {
      seqPicker.hidden = false
      seqPicker.innerHTML = `<p class="pg-seq-none">No tool matches "${escapeHtml(
        fragment
      )}".</p>`
      return
    }

    seqPicker.hidden = false
    seqPicker.innerHTML = matches
      .map(
        (name) =>
          `<button type="button" data-pick="${escapeHtml(name)}">@${escapeHtml(
            name
          )}</button>`
      )
      .join("")

    seqPicker.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => {
      b.addEventListener("click", () => {
        const { source, caret } = insertMention(
          seqSource.value,
          seqSource.selectionStart ?? seqSource.value.length,
          b.dataset.pick as string
        )
        seqSource.value = source
        closePicker()
        // Restore the caret: writing `value` puts it at the end otherwise,
        // which throws the author out of the sentence they were part-way
        // through.
        seqSource.focus()
        seqSource.setSelectionRange(caret, caret)
      })
    })
  }

  const syncPicker = () => {
    const fragment = activeFragment(
      seqSource.value,
      seqSource.selectionStart ?? seqSource.value.length
    )
    if (fragment === null) closePicker()
    else showPicker(fragment)
  }

  seqSource.addEventListener("input", syncPicker)
  seqSource.addEventListener("click", syncPicker)
  seqSource.addEventListener("keyup", (event) => {
    if (event.key === "Escape") closePicker()
    else syncPicker()
  })

  seqGo.addEventListener("click", async () => {
    const source = seqSource.value.trim()
    if (!source) {
      seqStatus.textContent = "Describe the flow first."
      return
    }

    const available = availableTools()
    const unknown = unknownMentions(source, available)
    if (unknown.length > 0) {
      // Refused rather than compiled around: a mention that names nothing is
      // a typo, and compiling would silently drop the step it was meant to be.
      seqStatus.textContent =
        `No tool named ${unknown.map((n) => `@${n}`).join(", ")}. ` +
        `Pick from the list with @.`
      seqStatus.classList.add("is-error")
      return
    }

    seqGo.disabled = true
    seqStatus.classList.remove("is-error")
    seqStatus.textContent = "Compiling…"
    seqPreview.hidden = true

    try {
      const response = await fetch(`${serverOrigin(apiUrl)}/compile-sequence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source,
          availableTools: available,
          existingIds: sequences
            .map((d) => d.compiled?.id)
            .filter((id): id is string => Boolean(id)),
        }),
      })

      const body = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : `failed (${response.status})`
        )
      }

      const { sequence, warnings } = body as unknown as CompiledSequence
      showPreview(sequence, warnings ?? [], source)
    } catch (cause) {
      seqStatus.textContent =
        cause instanceof Error ? cause.message : "could not compile that flow"
      seqStatus.classList.add("is-error")
    } finally {
      seqGo.disabled = false
    }
  })

  /*
   * The compiled flow, before it is registered.
   *
   * Shown with its warnings rather than added straight away. The compiler
   * settles questions the prose left open — an argument it could not map to a
   * captured answer, a step whose order was ambiguous — and those are cheap
   * to fix here and expensive to notice once a visitor is mid-flow.
   */
  function showPreview(
    sequence: Sequence,
    warnings: string[],
    source: string
  ): void {
    seqStatus.textContent = ""
    seqPreview.hidden = false
    seqPreview.innerHTML = `
      <ol class="pg-seq-steps">
        ${sequence.steps
          .map((step) =>
            step.kind === "ask"
              ? `<li class="is-ask">ask <em>${escapeHtml(step.field)}</em>` +
                ` — ${escapeHtml(step.prompt)}</li>`
              : `<li>${escapeHtml(step.tool)}${
                  step.inputFrom
                    ? ` <em>${escapeHtml(
                        Object.entries(step.inputFrom)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")
                      )}</em>`
                    : ""
                }</li>`
          )
          .join("")}
      </ol>
      ${
        warnings.length
          ? `<ul class="pg-seq-warnings">${warnings
              .map((w) => `<li>${escapeHtml(w)}</li>`)
              .join("")}</ul>`
          : ""
      }
      <div class="pg-form-actions">
        <button type="button" class="pg-seq-add">Add sequence</button>
        <button type="button" class="pg-secondary pg-seq-discard">Discard</button>
      </div>`

    ;(seqPreview.querySelector(".pg-seq-add") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        sequences = [
          ...sequences,
          { source, mentions: mentionsIn(source), compiled: sequence },
        ]
        saveSequences(sequences)
        registerSequence(sequence)
        renderSequences()
        seqSource.value = EMPTY_SEQUENCE.source
        seqPreview.hidden = true
        seqStatus.textContent = `Added "${sequence.label}".`
      }
    )
    ;(
      seqPreview.querySelector(".pg-seq-discard") as HTMLButtonElement
    ).addEventListener("click", () => {
      seqPreview.hidden = true
    })
  }

  applySequences()
  applyTools()

  const draftButton = root.querySelector(".pg-draft-go") as HTMLButtonElement
  const draftStatus = root.querySelector(".pg-draft-status") as HTMLElement
  const intent = field<HTMLTextAreaElement>("intent")

  draftButton.addEventListener("click", async () => {
    const text = intent.value.trim()
    if (!text) {
      draftStatus.textContent = "Say what the tool should do first."
      return
    }

    draftButton.disabled = true
    draftStatus.textContent = "Drafting…"
    draftStatus.classList.remove("is-error")

    try {
      const response = await fetch(`${serverOrigin(apiUrl)}/draft-tool`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: text,
          // So it does not re-invent a tool that already exists, or collide
          // with a name that is taken.
          existingNames: tools.map((t) => t.name),
          widgetIds: WIDGET_IDS,
        }),
      })

      const body = (await response.json()) as Record<string, unknown>
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : `failed (${response.status})`
        )
      }

      const drafted = body as unknown as DraftedTool
      field<HTMLInputElement>("name").value = drafted.name
      field<HTMLTextAreaElement>("description").value = drafted.description
      field<HTMLTextAreaElement>("schemaText").value = JSON.stringify(
        drafted.inputSchema,
        null,
        2
      )
      field<HTMLTextAreaElement>("returnText").value = JSON.stringify(
        drafted.returnValue,
        null,
        2
      )

      const kind = drafted.returnKind === "widget" ? "widget" : "json"
      const radio = form.querySelector<HTMLInputElement>(`[value="${kind}"]`)
      if (radio) radio.checked = true
      if (drafted.widgetId) {
        field<HTMLSelectElement>("widgetId").value = drafted.widgetId
      }
      field<HTMLTextAreaElement>("summary").value = drafted.summary ?? ""
      syncReturnKind()

      // Surface anything already wrong, so the draft is reviewed rather than
      // trusted — the model is good at this, not infallible.
      showErrors(validate(readDraft(), tools.map((t) => t.name)))
      draftStatus.textContent = drafted.note
        ? `Drafted. ${drafted.note}`
        : "Drafted — review it before adding."
    } catch (cause) {
      draftStatus.textContent =
        cause instanceof Error ? cause.message : "could not draft a tool"
      draftStatus.classList.add("is-error")
    } finally {
      draftButton.disabled = false
    }
  })

  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const draft = readDraft()
    const errors = validate(
      draft,
      tools.map((t) => t.name)
    )
    showErrors(errors)
    if (!isValid(errors)) return

    drafts = [...drafts, draft]
    persistCustom()
    // A tool you just wrote is one you want to try.
    enabled.add(draft.name.trim())
    saveEnabled(enabled)
    renderTools()
    resetForm()
    newPanel.open = false
  })
}
