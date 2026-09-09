# Chatbot Widget Embedding — Shadow DOM and Web Components
_Drop one `<script>` tag into any website, write one custom HTML tag, and you're done — the chatbot is ready, with no framework and without breaking the host page's CSS._

## What is this?

`apps/chatbot` is an embeddable widget that ships as a native Web Component (a built-in browser feature, not a library) — `<freddy-chat>`. Any website — React, plain HTML, WordPress — can include one `<script>` and write `<freddy-chat api-url="...">`, and a full React 19 app runs inside it. The trick is that the entire widget renders inside a "closed shadow DOM" (a browser-native private mini-DOM), which isolates it completely from the host page.

## Why it exists

Two problems had to be solved. First: the widget gets dropped onto any random website, whose CSS could be anything. If it rendered in the normal DOM, the host's CSS would break the widget and the widget's CSS would break the host page. Shadow DOM shuts both directions off.

The second problem was popups. The UI library (Base UI) portals popups into `document.body` by default, which is OUTSIDE the shadow boundary — so a popup rendered there can't see the widget's stylesheet at all. The code explains it itself:

```tsx
// apps/chatbot/src/lib/shadow.tsx:6-11
 * Base UI portals default to `document.body`, which is outside our shadow
 * boundary — a portalled popup would render unstyled, since the injected
 * stylesheet only exists inside the root. It also cannot go on the bare shadow
 * root: the React container is `display: contents`, leaving a portal there with
 * no stacking context, so it paints behind the host page. `mount()` creates a
 * fixed, high-z-index layer for it instead.
```

## How it works, step by step

1. **Registration.** As soon as `src/index.ts` loads it calls `defineElement()`, which runs `customElements.define("freddy-chat", ChatWidgetElement)` (`element.tsx:60-64`). From then on the browser treats `<freddy-chat>` as a real HTML element.

2. **Two ways to use it.** Either write `<freddy-chat mode="inline">` in the page yourself, or just drop in `<script data-auto>` and `autoMount()` (`index.ts:45-60`) creates the element and appends it to `document.body` for you.

3. **`connectedCallback()`** (which the browser calls the moment the element enters the DOM) parses the HTML attributes via `readConfig(this)` and calls `mount(this, config)` (`element.tsx:16-19`).

4. **The shadow root is created:** `host.attachShadow({ mode: "closed" })` (`mount.tsx:60`). "Closed" means even the host page's JS can't reach inside via `element.shadowRoot`.

5. **CSS is injected via `adoptedStyleSheets`,** not a normal `<style>` tag — because Vite would normally put that `<style>` in the page's `<head>`, which isn't visible inside the shadow root. An `?inline` import gives the CSS as a string, which is parsed into one `CSSStyleSheet` shared across all instances (`mount.tsx:29-36`).

6. **A portal layer is created** — a `<div>` inside the shadow root with `position: fixed` and a high `z-index` (`mount.tsx:76-84`). `ShadowContext` (`lib/shadow.tsx`) passes it down the React tree so popups portal there instead of into `document.body`.

7. **React renders** via `createRoot(container).render(<App .../>)`. `App` (`app.tsx`) renders `FloatingContainer` / `InlineContainer` / `FullscreenContainer` depending on the mode.

8. **Live attribute changes.** `attributeChangedCallback()` (`element.tsx:26-46`) handles only `theme` cheaply. A change to any other attribute (like `mode`) replaces the whole element — because an attached shadow root can't be moved to a new host, so a fresh element is the only option.

9. **Imperative control.** The host page can drive the widget from its own button: `document.querySelector('freddy-chat').open()`, because `open()`/`close()`/`toggle()` are methods on the `ChatWidgetElement` class itself (`element.tsx:49-57`).

10. **Teardown.** `disconnectedCallback()` calls `widget.destroy()`, which unmounts the React root inside a `queueMicrotask` (React warns if you unmount in the middle of its render cycle).

## Code walkthrough

- **`element.tsx:10-19`** — `ChatWidgetElement extends HTMLElement`, a native custom element class. `connectedCallback` parses the config and calls `mount()` — the widget's entry point.

- **`mount.tsx:59-60`** — the line that creates the closed shadow DOM:
```tsx
export function mount(host: HTMLElement, config: WidgetConfig): MountedWidget {
  const shadow = host.attachShadow({ mode: "closed" })
```

- **`lib/shadow.tsx:13-19`** — `ShadowContext`, a React Context that makes the portal container available across the tree (accessed via `usePortalContainer()`).

- **`element.tsx:33-45`** — the split between theme and every other attribute, a classic interview "why":
```tsx
if (name === "theme") {
  this.#config = readConfig(this)
  this.#widget.setTheme(this.#config.theme)
  return
}
// A shadow root cannot be detached, so a remount means a fresh host.
const replacement = document.createElement(TAG_NAME)
```

- **`lib/config.ts:58-70`** — `readConfig()` converts HTML attributes into a typed `WidgetConfig`, with sensible fallbacks.

- **`mount.tsx:91-106`** — inline mode has to size the host explicitly (it participates in page layout); floating/fullscreen escape layout by using `display: contents`.

## Diagram

The diagram below (`02-chatbot-widget-embedding.excalidraw`) shows how the widget nests inside the host page. Open it on excalidraw.com via File → Open, or drag the file straight onto the canvas.

The flow: the outermost box is "Host Website (real DOM)" — inside it `document.body` is its own box (there to show that popups do NOT go there). Inside that is the box for the `<freddy-chat>` element. Inside that box is a dashed-border box, "Shadow DOM (closed)" — the isolation boundary. Within that boundary are two boxes side by side: "React App Tree" (where `App`, the containers, and ChatPanel render) and "Portal Layer" (fixed, high z-index, where dropdowns/dialogs go). One arrow labeled "attachShadow(closed)" runs from `<freddy-chat>` toward the shadow boundary. Another arrow runs from `document.body` to "Portal Layer" with a crossed-out/blocked mark — showing where a normal Base UI portal would have gone, and that we redirected it inside the shadow instead.

## Interview questions

**Q: How does `<freddy-chat>` work on the host page with no framework?**
A: It's a native Web Component — `customElements.define("freddy-chat", ChatWidgetElement)` (`element.tsx:60-64`) teaches the browser what the tag means. The browser calls `connectedCallback()` itself; no framework runtime is needed on the host page at all.

**Q: What is Shadow DOM, and why is it used here?**
A: A private mini-DOM tree attached to an element, with its own style scope. Isolation was needed in both directions: the host's CSS must not break the widget, and the widget's CSS must not break the host. `host.attachShadow({ mode: "closed" })` (`mount.tsx:60`) gives both.

**Q: "closed" vs "open" shadow root — why closed here?**
A: In open mode the host page's JS can reach in and mutate through `element.shadowRoot`. In closed mode that property returns `null`. The comment (`mount.tsx:56-57`) is explicit: "so host-page scripts cannot reach in via `.shadowRoot` and mutate our DOM."

**Q: Why do theme changes and mode changes behave differently?**
A: Theme is just a `data-theme` flag and can be updated in place. `mode`/`position`/`trigger` change the shape of the tree, and once a shadow root is attached it can't be moved to a new host — so replacing the old element is the only way (`element.tsx:40-45`).

**Q: Where do Base UI popups go by default, and how does the widget handle that?**
A: Into `document.body` by default — outside the shadow boundary, so they'd render unstyled. The fix: `mount()` creates a `fixed`, high-`z-index` div inside the shadow root (`mount.tsx:76-84`) and provides it to the whole tree through `ShadowContext`, so popups portal there.

**Q: Why is the React container `display: contents`, and why is the portal layer a separate div?**
A: `display: contents` creates no stacking context of its own — a portal in the bare container would have nothing to stack against and would paint behind the host page (`mount.tsx:73-75`). That's why the portal layer is separate, with `position: fixed` and an explicit `z-index`.

**Q: To add a new container mode (say "sidebar"), what would you have to touch?**
A: The `Mode` type and `MODES` array in `lib/config.ts` (`config.ts:1,41`), a new branch in `app.tsx`'s `content` ternary, and a new file in `containers/`. `mode` is already in `OBSERVED_ATTRIBUTES`, so the remount happens automatically.

**Q: Why `adoptedStyleSheets` instead of Vite's default `<style>` injection?**
A: Vite normally injects CSS into `<head>` as a `<style>` tag, which isn't visible inside the shadow root. So the raw CSS string is taken from an `?inline` import, turned into a `CSSStyleSheet`, and assigned to `adoptedStyleSheets` (`mount.tsx:6-8, 29-36, 63`) — one parsed sheet shared across all instances.

**Q: How could this design be misused (a breaking change)?**
A: The most common one: someone switches to `attachShadow({ mode: "open" })` because "it's easier to debug" — that breaks the isolation. Second: a new popup component doesn't use `usePortalContainer()` — it'll silently render unstyled in `document.body`, and TypeScript won't catch it. Third: a missing host height in inline mode — remove the `100dvh` fallback logic at `mount.tsx:96-106` and the panel grows indefinitely.

## Common confusions

- Shadow DOM looks like it's only for styling isolation, but `closed` mode adds a security dimension too — the host's JS can't reach in; it isn't just CSS isolation.
- "The custom element is just a wrapper" — no, `ChatWidgetElement` is itself a real `HTMLElement` subclass whose lifecycle methods the browser calls directly; React only mounts inside it.
- "Why replace the whole element on an attribute change" — it's not a React limitation but a browser-platform one: once a shadow root is attached, it can never be detached from that element.
- The portal layer's `pointer-events: none` (popups set their own `pointer-events: auto`) matters — without it you'd get an invisible click-blocking layer sitting over the widget.
