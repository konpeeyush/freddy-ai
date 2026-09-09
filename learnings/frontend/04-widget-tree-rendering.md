# Widget Tree Rendering
_How an interactive card renders inside an AI reply — without ever executing any code._

## What is this?

When Freddy (the product's AI) needs to show something better than text — a weather card, a carousel of hotel options, a lead-capture form — the backend sends a small JSON tree describing "which layout, which data". The `packages/widgets` package turns that JSON into real React UI. The whole system lives in three files: `tree.ts` (defines the format), `resolve.ts` (path lookup), and `render.tsx` (the recursive walker that builds the React tree).

## Why it exists

Widget data ultimately comes from an AI model's tool-call output or from knowledge-base content — **untrusted input**. If we handed that data to a templating engine that could evaluate JS expressions, model output (or text hidden in the KB) could theoretically run arbitrary code on the customer's site. The comment at the top of `tree.ts` says this plainly:

```ts
// tree.ts:6-9
// Authors write JSX in the dashboard; the dashboard compiles it to this and
// stores the result. The runtime only ever sees JSON: there is no parser and
// no evaluator here, which is the whole reason this is safe to render inside
// a customer's page.
```

The author writes JSX in the dashboard, but only plain JSON ever reaches the runtime — no `eval`, no expression parser. `resolve.ts:11-13` says the same thing: "there is no expression parser and nothing is evaluated — `resolve` walks an object with string keys."

## How it works, step by step

1. **A definition is registered.** Each widget is a `WidgetDefinition` — an id, a Zod schema, and `states` (named JSON trees). They're registered per customer in `registry.ts`, because old conversation messages have to render against their original version.

2. **Widget data arrives from a tool call.** When the AI calls a tool, the response comes in the `WidgetPayloadSchema` shape (`tree.ts:245-252`) — `widgetId`, `version`, `data`, and a text `summary` (the fallback).

3. **The `Widget` component picks a state.** `render.tsx:164-276` picks one state out of the definition's `states` map — if `stateBy` is given, a field of the data decides it (say, the booking widget's "form" vs "confirmed"). The state is derived from the data, so reopening the conversation deterministically brings back the same visual state.

4. **`RenderNode` walks the tree recursively.** `when` is checked first — if it's false, neither the node nor its children are ever resolved or mounted (`render.tsx:79`). Then, if there's a `repeat`, `expandRepeat` expands the array into N sibling elements, each with its own `$item`/`$index` scope (`render.tsx:46-74`).

5. **Props are resolved.** `resolveProps` (`resolve.ts:211-221`) leaves literal values as-is, walks `{$bind: "$.path"}` objects through `resolvePath` to pull out the value, and then applies the optional `fallback` and `format` (money/date/number/...).

6. **Handoff to a fixed primitive component.** The node's `type` (Box, Card, Title, Button...) looks up a real React component in the `PRIMITIVES` registry (`primitives/index.ts:34-59`). If the `type` is unknown (an old version, a bug), it returns `null` with just a console warning — the whole widget doesn't crash (`render.tsx:82-87`).

7. The result: a deterministic React tree, where every step is a lookup or a switch — no arbitrary code executes anywhere.

## Code walkthrough

- **`tree.ts:155-186`** — `NODE_TYPES` is a fixed array (Box, Row, Card, Title, Button, Form, Carousel, Chart...). That closed set is the core of the safety story: "an author cannot introduce a new primitive" (`tree.ts:152-154`).

- **`tree.ts:27-35`** — `isSafeUrl`: control characters are stripped first, and only then is the scheme matched against an allowlist (`http:`, `https:`, `mailto:`, `tel:`) — browsers strip tabs/newlines out of URLs on their own, so `"jav\tascript:"` could bypass a naive check:
```ts
const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)
if (!scheme) return true // relative: /path, ./x, #hash, ?q
return SAFE_URL_SCHEMES.has(scheme[0].toLowerCase())
```

- **`resolve.ts:64-73`** — `resolvePath` explicitly rejects prototype-pollution-unsafe keys, because the data is model-authored JSON:
```ts
if (key === "__proto__" || key === "constructor" || key === "prototype") {
  return undefined
}
```

- **`render.tsx:46-73`** — `expandRepeat` expands the array into sibling elements (not into one fragment), because a primitive like `Carousel` slots its children individually — an earlier, wrong implementation of this caused a vertical-stack bug.

- **`stock/weather.ts:81-94`** — a real example: a `Box` inside a `Card` with a literal `"#2563eb"` background (theme-independent, because it's the card's identity), with `city`/`temperature` as bound values.

## Diagram

The diagram (`04-widget-tree-rendering.excalidraw`) shows how data travels from an untrusted source to safely rendered UI (on excalidraw.com use File → Open, or drag it in). The flow runs left to right:

1. An **"LLM / Knowledge base (untrusted)"** box — where the tool-call data originates.
2. Arrow → a **"Widget data (JSON tree)"** box — the `WidgetPayloadSchema` shape.
3. Arrow → the **"RenderNode walker"** box (`render.tsx`), the central engine.
4. Three branch boxes come off it: **"when? → skip node"**, **"repeat? → expand N siblings"**, and **"resolve $bind props (path lookup only)"** — all three are decisions, none evaluates an expression.
5. All branches → the **"Fixed set of React primitives"** box (the `PRIMITIVES` registry).
6. The final box: **"Rendered card in chat UI"**.
7. A small red caption at the bottom, "no eval() anywhere" — reinforcing that every step is a lookup or a switch, never an interpreter.

## Interview questions

**Q: Why is widget data untrusted, and what is this system's core safety guarantee?**
A: The data ultimately comes from AI tool-call output or knowledge-base content — neither of which is under Freddy's own deterministic control. The core guarantee: there is no expression evaluator anywhere in the render pipeline — the renderer picks from a closed `NODE_TYPES` list and only walks `$bind` paths, never executing a string as code (`tree.ts:7-9`).

**Q: What's the fundamental difference between `{$bind: "$.path"}` and a JS template string?**
A: A template string evaluates an expression — arithmetic, function calls, anything. `$bind` is only a dot/bracket path, which `resolvePath` (`resolve.ts:47-74`) walks by plain object traversal — no parser, just `.split(".")` and key lookups. There's no room for computation at all.

**Q: How could a prototype pollution attack have come through widget data, and how does the code prevent it?**
A: If the model sent a path like `"$.__proto__.polluted"` and the lookup blindly did `base[key]`, it could reach `Object.prototype`. `resolve.ts:65-67` explicitly rejects `__proto__`, `constructor`, and `prototype` segments — and that check lives inside every path lookup, so it can't be bypassed.

**Q: Why don't children mount when `when` is false, and why does that matter?**
A: `RenderNode` (`render.tsx:79`) checks `when` first — on false it returns `null` immediately, and props are never resolved and children never recursed. So a malformed or missing-data child never even attempts to render unless its parent is visible.

**Q: Why is `repeat` implemented as a separate function instead of returning a single fragment?**
A: The comment (`render.tsx:120-133`) explains it — if repeat returned a `<>{...}</>` fragment, a parent like `Carousel` that slots children individually would see only "one child" and the whole fragment would land in a single slot (the vertical-stack bug). So `expandRepeat` returns a `ReactElement[]` that merges into the parent's flat children array.

**Q: Does a version mismatch (old definition, new data shape) crash things?**
A: No, the system degrades deliberately. `getWidget` (`registry.ts:48-62`) falls back to the latest when the exact version isn't found. An unknown node type yields `null` with just a warning (`render.tsx:82-87`). A missing field makes `resolvePath` return `undefined`, which renders silently empty — "an unresolved binding renders as empty rather than as an error" (`registry.ts:44-46`).

**Q: How does `stateBy` make a widget "reconstructible"?**
A: `stateBy` looks up the value of one data field in a `map` to decide which named `states` entry renders (`render.tsx:250-257`). The state is derived from the data, not from local React state — so reopening the conversation replays the stored `data` and deterministically restores exactly the same state, the way a booking permanently sticks in its "confirmed" state after `onDataChange` (`render.tsx:200-208`).

**Q: To add a new widget primitive, what would you have to touch?**
A: Three places: a new string in `tree.ts`'s `NODE_TYPES`, a React component in `primitives/`, and a mapping in `primitives/index.ts`'s `PRIMITIVES` record. `PRIMITIVES` is typed as `Record<NodeType, ComponentType<...>>` — so if you forget to add the renderer, the TypeScript compile fails rather than silently giving you a blank widget.

## Common confusions

- People read `$bind` as a mini templating language where you can chain filters — it's actually just a path, with zero computation.
- People read `when` as a full JS boolean expression — it's actually just an `is`/`oneOf`/truthiness test against one path (`tree.ts:83-96`); it can't compare two paths.
- People treat `repeat` like `.map()` with an arbitrary transform — it only iterates an array; filtering/sorting logic has to be ready in the data itself.
- Newcomers assume Zod schema validation handles the security — the schema only checks shape; XSS/injection protection comes from the specific checks (`isSafeUrl`, the prototype-key guard), not from generic validation.
