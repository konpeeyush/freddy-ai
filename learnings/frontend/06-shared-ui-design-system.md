# Shared UI / Design System — shadcn + Base UI + Tailwind v4
_One Button.tsx, two apps — not copy-paste, an actual shared package._

## What is this?

`packages/ui` is a workspace package (`@workspace/ui`) holding all the shared UI components — Button, Dialog, Table, Sidebar, and chat-specific pieces like `Markdown` and `MessageBubble`. Both apps — `apps/chatbot` (the widget) and `apps/dashboard` (the operator UI) — import from it as `@workspace/ui/components/<name>`, as if it were a real npm package. The repo calls its style "base-maia" (`README.md:5`).

This isn't just a "component library" — it's a stack of 5 different tools that together produce one final, styled, accessible component.

## Why it exists

There are two apps (the chatbot widget and the dashboard), and both need the same look and feel — the same Button, the same Dialog, the same colors — otherwise the design drifts. Hence a single source of truth: `packages/ui`.

The big decision here is that **shadcn is not an npm package you `pnpm add`**. It's a CLI that copies a component's full source code into your repo (`packages/ui/src/components/button.tsx`). Meaning the code is yours, you can edit it directly, and you're not stuck behind some locked npm package version. Look at `packages/ui/components.json`:

```json
"style": "base-maia",
"aliases": { "ui": "@workspace/ui/components" },
"iconLibrary": "hugeicons"
```

This config decides where a newly generated component lands and which icon set it uses — repo-specific defaults that override shadcn's generic setup.

A "why" comment in `markdown.tsx` shows the real purpose of sharing:

```
Shared verbatim by the chatbot widget and the dashboard's
conversation view, so an operator sees exactly what a visitor saw.
```
(`packages/ui/src/components/chat/markdown.tsx:85`)

So this isn't only about DRY (Don't Repeat Yourself) — it's needed for behavior parity too. With separate renderers, citation links or code blocks could render differently from what the visitor actually saw.

## How it works, step by step

A component (like Button) is assembled from 5 layers, bottom to top:

1. **Tailwind CSS v4** — the bottom layer, the actual utility classes (`bg-primary`, `rounded-4xl`, etc.) that generate CSS. `globals.css` starts with `@import "tailwindcss"` (`packages/ui/src/styles/globals.css:1`).

2. **@base-ui/react** — the headless behavior primitive. "Headless" means no visual styling, only behavior — focus trap, keyboard navigation (Escape closing a dialog), ARIA attributes. In `dialog.tsx`, `DialogPrimitive.Root` and `DialogPrimitive.Popup` come from Base UI — so accessibility didn't have to be hand-rolled (`packages/ui/src/components/dialog.tsx:2`).

3. **The shadcn CLI** — when you need a new component: `pnpm dlx shadcn add <component> -c apps/dashboard`. It runs from an app, but the generated file is saved into `packages/ui/src/components/` — immediately available to both apps.

4. **class-variance-authority (CVA)** — defines the styling "variant system" on top of Base UI. Look at `button.tsx`'s `buttonVariants` — `variant: "default" | "outline" | "ghost" | "destructive" | "link"` and `size: "default" | "xs" | "sm" | "lg" | "icon"`, with a typed class string for every combination (`packages/ui/src/components/button.tsx:5-38`).

5. **The `cn()` helper (clsx + tailwind-merge)** — when a caller passes a `className` (e.g. a custom background), it merges the two class lists intelligently — with conflicting Tailwind classes (say two `bg-*`), only the last one wins:

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
(`packages/ui/src/lib/utils.ts:4-6`)

6. The final component is exported (`Button`, `buttonVariants`) — `packages/ui/package.json`'s `exports` map is what shows it to the outside world:

```json
"exports": {
  "./globals.css": "./src/styles/globals.css",
  "./lib/*": "./src/lib/*.ts",
  "./components/*": "./src/components/*.tsx",
  "./hooks/*": "./src/hooks/*.ts"
}
```
(`packages/ui/package.json:46-51`)

7. Both apps import it — `apps/chatbot/src/chat/panel.tsx` and `apps/dashboard/src/modules/conversations/conversation-id-view.tsx` both import `MessageBubble` from `@workspace/ui/components/message-bubble`. One file, rendering in two runtime contexts (the widget's shadow DOM and the dashboard's normal DOM). This 7-step pipeline — from component generation to shared import — is exactly what the diagram covers.

## Code walkthrough

- `packages/ui/package.json:12-29` — lists the whole stack in one place: `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, `clsx`, `shadcn`, `@fontsource-variable/figtree`, `@hugeicons/react`, `motion`, `dompurify`, `marked`.

- `packages/ui/src/components/button.tsx:40-53` — the `Button` function wraps `ButtonPrimitive` (Base UI), computes classes via `cn(buttonVariants({ variant, size, className }))`, and sets a `data-slot="button"` attribute. `dialog.tsx:75-79` reuses that same `Button` for the close icon through Base UI's `render` prop (`render={<Button variant="ghost" size="icon-sm" />}`) — a real example of composition.

- `packages/ui/src/components/dialog.tsx:55-64` — a detailed rationale comment explains why `[&>*]:min-w-0` is needed: a grid item's default minimum width equals its content's min-content size, and one long filename (with no spaces) can push the whole box wider than the viewport — a subtle CSS gotcha, already documented.

- `packages/ui/src/styles/globals.css:1-4` — four imports: Tailwind itself, `tw-animate-css`, `shadcn/tailwind.css` (the base preset), and `@fontsource-variable/figtree` — meaning the Figtree font is bundled locally, with no external Google Fonts call at runtime.

- `packages/ui/src/styles/globals.css:55-89` — all design tokens are defined in the `oklch()` color space (`--primary`, `--background`, etc.), with their dark-mode variants inside the `.dark` class — and the CVA variants reference those tokens, never hardcoded hex.

- `packages/ui/src/components/chat/markdown.tsx:116` — `DOMPurify.sanitize(marked.parse(...))`: the AI's reply is a markdown string, `marked` turns it into HTML, and then `DOMPurify` sanitizes that HTML — because the HTML ultimately comes from an LLM, sanitizing before it goes into `dangerouslySetInnerHTML` is essential.

## Diagram

The diagram below (`06-shared-ui-design-system.excalidraw`) shows how a component is built layer by layer and then shared across two apps. Open it on excalidraw.com via File → Open, or drag the file onto the canvas.

It's a "layer cake", bottom to top: "Tailwind v4 (utility CSS)", above it "CVA (variant definitions)", above that "Base UI (accessible behavior, no styling)", above that "shadcn CLI (generates owned source)", and at the very top "button.tsx — final component", which lives in `packages/ui/src/components/`. Two arrows lead up and out of the top box, ending in the "apps/chatbot" and "apps/dashboard" boxes — both importing the same component. A small caption points at the `@workspace/ui/components/*` exports path.

## Interview questions

**Q: If shadcn isn't a "component library", what is it?**
A: It's a code generator/CLI. Running `shadcn add <component>` copies that component's full source code into `packages/ui/src/components/` — we become the owners of that code, not locked behind an npm package version. That's exactly why we could put our own rationale comment (the min-w-0 one) in `dialog.tsx` — because the file is ours.

**Q: What's the difference between Base UI and CVA — don't both look "styling-related"?**
A: Base UI gives zero styling — only behavior and accessibility (focus trap, keyboard nav, ARIA). CVA gives only styling — it organizes Tailwind class strings into named variants (`variant`, `size`), with no behavior. In `button.tsx` they're separate imports: `ButtonPrimitive` from `@base-ui/react/button` (behavior) and `cva()` (styling) — two independent concerns being composed.

**Q: Why is the `cn()` helper needed — why not just join classes with a template string?**
A: Because Tailwind classes can conflict. `Button`'s default is `bg-primary`; if a caller passes `className="bg-red-500"`, a plain concat sends both classes into the CSS and an unpredictable order wins. `tailwind-merge` (`packages/ui/src/lib/utils.ts:4-6`) understands both target the same property (background-color) and keeps only the last one.

**Q: The `Markdown` component is used in both the chatbot and the dashboard — what's the risk of forking/duplicating it?**
A: The biggest risk: the operator (in the dashboard) and the visitor (in the widget) could see different rendering — citation pills that click through in one place but not the other, or markdown sanitization rules that diverge. The comment says it itself: "Shared verbatim... so an operator sees exactly what a visitor saw" (`packages/ui/src/components/chat/markdown.tsx:85`). Forking breaks that guarantee silently — the bug wouldn't even be immediately visible.

**Q: The widget (`apps/chatbot`) is a closed shadow DOM custom element. What extra care do shared components need when rendering there?**
A: Shadow DOM gives CSS isolation, which means globals.css (the Tailwind output) has to be injected inside the shadow root too, or the components render unstyled. It's also why `markdown.tsx` uses an `onCitationClick` callback prop instead of native `href="#id"` navigation — the comment explicitly says hash navigation can't cross the shadow root boundary (`packages/ui/src/components/chat/markdown.tsx:104-107`).

**Q: Why the `oklch()` color space instead of hex/rgb?**
A: Every token in `globals.css` (`--primary`, `--background`, etc.) is in `oklch(L C H)` format — perceptually uniform, meaning the same lightness value looks similarly bright across different hues, which makes dark-mode tuning predictable. A comment backs this up: dark mode's destructive red was kept lighter to cut glare, and the foreground contrast was chosen by explicitly measuring it (`packages/ui/src/styles/globals.css:106-110`).

**Q: Without CVA, how much messier would variant management be?**
A: You'd write manual ternaries everywhere (`variant === "outline" ? "..." : ...`), with no type safety and no `defaultVariants` fallback. CVA gives TypeScript the valid union types for variant/size automatically through `VariantProps<typeof buttonVariants>` (`packages/ui/src/components/button.tsx:45`) — passing an invalid variant becomes a compile-time error.

## Common confusions

- People think shadcn is "installed" like a normal npm package — it actually generates code for you; the `shadcn` entry in `package.json` is only the CLI dependency, the components aren't in it.
- People read `cn()` as just a "classnames helper" — its real value is tailwind-merge's conflict resolution, not array joining.
- Base UI and shadcn get treated as the same thing — Base UI is the behavior primitive (an alternative to Radix), while shadcn is the CLI tool that brings styling on top of it. Either can be replaced independently.
- The `chat/` folder name makes it look chatbot-app-specific, but the dashboard's conversation view uses the same files — the name describes the feature domain, not the app.
