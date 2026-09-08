import {
  onWidgetAction,
  registerWidgets,
  type WidgetActionEvent,
} from "@workspace/widgets"

import { defineElement, TAG_NAME, ChatWidgetElement } from "./element"
import { clearChat } from "./chat/store"
import {
  registerTool,
  registerTools,
  unregisterTool,
  type ToolDefinition,
} from "./tools/registry"
import {
  onSequence,
  registerSequence,
  unregisterSequence,
  type SequenceEvent,
} from "./tools/sequences"
import { deliverSequences, type DeliveryOptions } from "./tools/deliver"

/*
 * The stock definitions register in `mount()`, not here — that is the one
 * path every surface shares, and this entry is only loaded by the shipped
 * bundle. `registerWidgets` is still re-exported below so a host page can
 * add its own definitions on top.
 */

/**
 * Entry point for the embeddable bundle.
 *
 * Two ways to use it:
 *
 *   1. Custom element — the page decides placement. Required for inline/aside.
 *        <script src="widget.js"></script>
 *        <freddy-chat mode="inline"></freddy-chat>
 *
 *   2. Auto-mount — one tag, nothing else. Creates its own host and pins it
 *      to a corner. Convenient for tag-manager installs.
 *        <script src="widget.js" data-auto data-mode="floating"></script>
 */
defineElement()

function autoMount() {
  const script = document.currentScript as HTMLScriptElement | null
  // currentScript is null for module scripts, so fall back to a lookup.
  const el =
    script ?? document.querySelector<HTMLScriptElement>("script[data-auto]")
  if (!el || !el.hasAttribute("data-auto")) return
  if (document.querySelector(TAG_NAME)) return

  const host = document.createElement(TAG_NAME)
  for (const { name, value } of Array.from(el.attributes)) {
    if (name.startsWith("data-") && name !== "data-auto") {
      host.setAttribute(name.slice(5), value)
    }
  }
  document.body.appendChild(host)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMount, { once: true })
} else {
  autoMount()
}

function find(): ChatWidgetElement | null {
  return document.querySelector<ChatWidgetElement>(TAG_NAME)
}

/** Global handle so a host page can drive the widget from its own button. */
export const FreddyChat = {
  open: () => find()?.open(),
  close: () => find()?.close(),
  toggle: () => find()?.toggle(),
  mount(options: Record<string, string> = {}) {
    const host = document.createElement(TAG_NAME)
    for (const [k, v] of Object.entries(options)) host.setAttribute(k, v)
    document.body.appendChild(host)
    return host as ChatWidgetElement
  },

  /** Registers widget definitions authored in the dashboard. */
  registerWidgets,

  /**
   * Registers a tool the page executes itself.
   *
   * The server holds no copy: the definition is sent with every request and
   * the handler runs here, so a tool can read anything the page can — the
   * cart, the signed-in user, the DOM.
   *
   *   FreddyChat.registerTool({
   *     name: "getCartTotal",
   *     description: "The total value of the visitor's cart right now.",
   *     inputSchema: { type: "object", properties: {} },
   *     handler: () => ({ total: cart.total, items: cart.count }),
   *   })
   *
   * `inputSchema` is plain JSON Schema. Providers vary in how much of it they
   * honour, so treat it as a description of the arguments for the model, and
   * validate anything that matters inside the handler.
   *
   * Return a widget envelope to render a card instead of prose — the same
   * shape a dashboard-authored widget uses.
   */
  registerTool,
  registerTools,
  unregisterTool,

  /**
   * Forgets the stored conversation.
   *
   * The transcript is kept in the visitor's own browser so it survives a
   * reload. Call this when that is no longer the right thing to keep — on
   * sign-out, or when the page wants a deliberately fresh start.
   *
   * Takes effect on the next mount; a panel already open keeps what is on
   * screen.
   */
  clearConversation: clearChat,

  /**
   * Handles widget button clicks on the host page.
   *
   * Return a promise to acknowledge: the button shows pending until it
   * settles, a tick on resolve, and your message inline on reject. Resolve
   * with replacement widget data to move the widget to its next state.
   *
   *   FreddyChat.onAction(async (e) => {
   *     if (e.functionName !== "book_class") return
   *     await api.book(e.payload.name)
   *     return { ...e.payload, bookedClass: e.payload.name }
   *   })
   *
   * Registering any listener suppresses the default behaviour, which is to
   * send the click into the conversation and let the AI handle it.
   */
  onAction: (handler: (event: WidgetActionEvent) => unknown) =>
    onWidgetAction(handler),

  /**
   * Registers a flow whose steps run in a fixed order.
   *
   * A sequence pins ordering that prompting alone does not: while one runs,
   * only the step it is on is sent to the model, so a later tool cannot be
   * called early however the conversation goes.
   *
   *   FreddyChat.registerSequence({
   *     id: "demoRequest",
   *     label: "Demo request",
   *     trigger: "Use when someone asks for a demo or a callback.",
   *     steps: [
   *       { kind: "ask", field: "company", prompt: "which company they are with" },
   *       { kind: "tool", tool: "createLead", inputFrom: { company: "$company" } },
   *     ],
   *   })
   *
   * Every tool a flow names must be registered, or it refuses to start —
   * a flow that stalls halfway is worse than one that never began.
   */
  registerSequence,
  unregisterSequence,

  /**
   * Observes flows starting, advancing and ending.
   *
   *   FreddyChat.onSequence((e) => {
   *     if (e.kind === "end" && e.reason === "completed") {
   *       crm.createLead(e.captured)
   *     }
   *   })
   *
   * `end` is the one most integrations want: it carries everything the flow
   * gathered in one object, and distinguishes a flow that finished from one
   * the visitor abandoned — a lead and a drop-off are different facts.
   *
   * Listeners are observers. Throwing does not stop the conversation, and
   * nothing waits on a returned promise; use `onAction` where you need to
   * acknowledge or change what the visitor sees.
   */
  onSequence,

  /**
   * Posts completed flows to an endpoint, with retries.
   *
   *   FreddyChat.deliverSequences({
   *     url: "https://example.com/api/leads",
   *     headers: { "x-api-key": "…" },
   *   })
   *
   * Each outcome is written to a queue in the visitor's browser before it is
   * sent, so a failed request, or a tab closed mid-send, is retried on their
   * next visit rather than lost. Completed flows only by default — an
   * abandoned one is a drop-off, not a lead; pass `filter` to change that.
   *
   * Delivery is at-least-once: a response that never arrives is retried, so
   * the endpoint must treat a repeated `id` as the same outcome. A visitor
   * who never returns cannot be recovered from the browser, so anything
   * critical still wants the receiving server to own the durable copy.
   *
   * Returns a function that stops delivery. Use `onSequence` instead where
   * you only want to observe.
   */
  deliverSequences,
}

declare global {
  interface Window {
    FreddyChat: typeof FreddyChat
  }
}
window.FreddyChat = FreddyChat

export { TAG_NAME, ChatWidgetElement }
export type { ToolDefinition, SequenceEvent, DeliveryOptions }
