import { mount, type MountedWidget } from "./mount"
import {
  readConfig,
  OBSERVED_ATTRIBUTES,
  type WidgetConfig,
} from "./lib/config"

export const TAG_NAME = "freddy-chat"

export class ChatWidgetElement extends HTMLElement {
  static observedAttributes = OBSERVED_ATTRIBUTES

  #widget: MountedWidget | null = null
  #config: WidgetConfig | null = null

  connectedCallback() {
    this.#config = readConfig(this)
    this.#widget = mount(this, this.#config)
  }

  disconnectedCallback() {
    this.#widget?.destroy()
    this.#widget = null
  }

  attributeChangedCallback(
    name: string,
    prev: string | null,
    next: string | null
  ) {
    if (prev === next || !this.#widget || !this.#config) return

    // Theme swaps in place; everything else changes the tree shape, so remount.
    if (name === "theme") {
      this.#config = readConfig(this)
      this.#widget.setTheme(this.#config.theme)
      return
    }

    // A shadow root cannot be detached, so a remount means a fresh host.
    const replacement = document.createElement(TAG_NAME)
    for (const attr of Array.from(this.attributes)) {
      replacement.setAttribute(attr.name, attr.value)
    }
    this.replaceWith(replacement)
  }

  // Imperative API, per element.
  open() {
    this.#widget?.handle?.open()
  }
  close() {
    this.#widget?.handle?.close()
  }
  toggle() {
    this.#widget?.handle?.toggle()
  }
}

export function defineElement() {
  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, ChatWidgetElement)
  }
}
