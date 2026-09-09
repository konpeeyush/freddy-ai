# Freddy AI — Interview Prep
_All the interview questions from the 10 topics in one place — grouped by topic, near-duplicates merged, so revising means less scrolling._

## Frontend

### Monorepo & Tooling ([full doc](frontend/01-monorepo-and-tooling.md))

**Q: What's the difference between pnpm workspaces and Turborepo?**
A: pnpm workspaces only handles *dependency linking* — it reads `pnpm-workspace.yaml` and symlinks `workspace:*` deps. Turborepo handles *task orchestration and caching* — `turbo.json`'s `dependsOn: ["^build"]` decides the order, and `outputs` caches the result. Either works without the other, just slower and with no dependency-order guarantee.

**Q: Why is `packages/api` called the "shared wire contract"?**
A: It isn't only types — it's runtime validation too. The Zod schemas validate incoming requests in the backend, and the TypeScript types derived from those same schemas are used by both apps at compile time. The header comment says it itself: add a field and TypeScript breaks whichever half you forgot to update (`schema.ts:3-9`) — one single source of truth, with both runtime and compile-time guarantees.

**Q: If a prop changes in `packages/ui`, do the dashboard and chatbot find out immediately?**
A: Yes, with no publish or version bump — pnpm symlinks `@workspace/ui` in both apps' `node_modules` straight to `packages/ui/src`. `tsc -b` reports a type error immediately when a prop breaks, and the Vite dev server hot-reloads because it's importing the real file.

**Q: Why doesn't the component land in the dashboard when you run `pnpm dlx shadcn add <component> -c apps/dashboard`?**
A: `-c apps/dashboard` only tells the CLI which Tailwind config/alias context to use; the actual destination is decided by `packages/ui`'s `"exports"` field (`"./components/*": "./src/components/*.tsx"`) — the CLI follows that convention.

**Q: Why is `turbo dev` set to `"cache": false, "persistent": true` when `build` is cached?**
A: `dev` is a never-exiting process (Vite dev server, `tsx watch`) whose output isn't deterministic — caching it would be wrong. `persistent: true` says it should keep running in the background. `build` is the opposite — deterministic `dist/**` output that can safely be cached and reused.

**Q: Why isn't `rootDir` set when deploying the backend on Render?**
A: `packages/backend`'s `workspace:*` deps (`@workspace/api`, `@workspace/rag`) only resolve when the install runs from the full workspace root (so the symlinks get created). Setting `rootDir` would install it in isolation and the deps would be missing. The `buildCommand` installs from the root, and the `startCommand` starts the backend specifically with `pnpm --filter @workspace/backend start`.

**Q: If `packages/backend` had to import `packages/widgets`, would that break the architecture?**
A: Yes — `packages/widgets`'s deps are only `@workspace/ui`, `react`, and `zod`, not the backend. That keeps it "pure render-a-tree logic", reusable anywhere React runs. Importing the backend would break that guarantee and could pull server-only code (like `better-sqlite3`) into the browser bundle.

**Q: To add a new `packages/analytics` (used only by the backend), what would you have to touch?**
A: Not `pnpm-workspace.yaml` (it already matches `packages/*`) — create a `package.json` with `name: "@workspace/analytics"`, add `"@workspace/analytics": "workspace:*"` to `packages/backend/package.json`, then run `pnpm install` to create the symlink. You don't touch `turbo.json`, because the task graph is derived automatically from the deps.

### Chatbot Widget Embedding ([full doc](frontend/02-chatbot-widget-embedding.md))

**Q: How does `<freddy-chat>` work on the host page with no framework?**
A: It's a native Web Component — `customElements.define("freddy-chat", ChatWidgetElement)` teaches the browser what the tag means. The browser calls `connectedCallback()` itself; no framework runtime is needed on the host page at all.

**Q: What is Shadow DOM, and why is it used here?**
A: A private mini-DOM tree attached to an element, with its own style scope. Isolation was needed in both directions: the host's CSS must not break the widget, and the widget's CSS must not break the host. `host.attachShadow({ mode: "closed" })` gives both.

**Q: "closed" vs "open" shadow root — why closed here?**
A: In open mode the host page's JS can reach in and mutate through `element.shadowRoot`. In closed mode that property returns `null` — "so host-page scripts cannot reach in via `.shadowRoot` and mutate our DOM."

**Q: Where do Base UI popups go by default, and how does the widget handle that?**
A: Into `document.body` by default — outside the shadow boundary, so they'd render unstyled. The fix: `mount()` creates a `fixed`, high-`z-index` div inside the shadow root and provides it to the whole tree through `ShadowContext`, so popups portal there.

**Q: Why is the React container `display: contents`, and why is the portal layer a separate div?**
A: `display: contents` creates no stacking context of its own — a portal in the bare container would have nothing to stack against and would paint behind the host page. That's why the portal layer is separate, with `position: fixed` and an explicit `z-index`.

**Q: Why do theme changes and mode changes behave differently?**
A: Theme is just a `data-theme` flag and can be updated in place. `mode`/`position`/`trigger` change the shape of the tree, and once a shadow root is attached it can't be moved to a new host — so replacing the old element is the only way.

**Q: Why `adoptedStyleSheets` instead of Vite's default `<style>` injection?**
A: Vite normally injects CSS into `<head>` as a `<style>` tag, which isn't visible inside the shadow root. So the raw CSS string is taken from an `?inline` import, turned into a `CSSStyleSheet`, and assigned to `adoptedStyleSheets` — one parsed sheet shared across all instances.

**Q: How could this design be misused (a breaking change)?**
A: The most common one: someone switches to `attachShadow({ mode: "open" })` because "it's easier to debug" — that breaks the isolation. Second: a new popup component doesn't use `usePortalContainer()` — it'll silently render unstyled in `document.body`, and TypeScript won't catch it. Third: a missing host height in inline mode — remove the `100dvh` fallback logic and the panel grows indefinitely.

### Chat State & Streaming ([full doc](frontend/03-chat-state-and-streaming.md))

**Q: Why are there two separate state containers in the chat panel — the Query cache and React state?**
A: Query is for the settled conversation, which has to survive the panel closing and reopening. The in-flight stream isn't in Query because its `notifyManager` batches notifications — writing every token into the cache coalesced a 7-chunk reply into just 2 paints. So the stream lives in plain `useState`, which re-renders immediately.

**Q: What is `MAX_TOOL_ROUNDS = 5` and why is it needed?**
A: It caps how many times a single turn can "bounce" between the model and the page's tools, mirroring the server's own step limit. Without a cap, a tool whose result nudges the model to call the same tool again could loop forever.

**Q: Why does a client tool call "pause" the turn instead of cancelling it?**
A: Only the browser can run a client tool. The stream ends, `runTool()` runs in the browser, and the result is appended to the next round's `outbound` messages — which avoids a dangling tool call, something the provider would reject on the next request.

**Q: Why are widgets and sources shown before the reply is complete?**
A: Retrieval finishes long before the closing sentence; holding the content back means showing a spinner over something that's already ready. `setStreamingWidgets`/`setStreamingSources` are called mid-stream.

**Q: Why isn't persistence (`saveChat`) done per token?**
A: `write()` is the single funnel every settled change passes through, and it's called once when the turn settles. Saving per token would mean far too many localStorage writes, and restoring a half-finished reply would be wrong anyway.

**Q: Why is `settledIds` a module-level `Set` rather than component state?**
A: Settling is two writes — the marker and the Query cache — with no shared schedule. When the cache write won the race, the finished reply visibly "slid up". A plain `Set` updates synchronously, so whichever render comes first already sees the updated marker.

**Q: Does the chat crash if `localStorage` quota is exceeded?**
A: No. `saveChat()` retries with progressively shorter tails — `[full, 20, 10, 4, 1]` messages. If nothing fits, it does a `removeItem` on its own key; the chat keeps working in memory, it just doesn't persist across a reload.

**Q: Does `retry()` resend the whole conversation?**
A: No. It finds the last user message, trims the cache up to that message (dropping the partial reply), calls `mutation.reset()`, and then `mutation.mutate()` with the same text — the turn runs fresh.

**Q: To add a new event kind (say `"reasoning"`), where would the changes go?**
A: The `StreamEvent` union in `packages/api/src/schema.ts`, a new branch in `use-chat.ts`'s `for await` loop (with its own `useState`, not in the Query cache), and an expose in the `ChatState` type so `panel.tsx` can render it.

### Widget Tree Rendering ([full doc](frontend/04-widget-tree-rendering.md))

**Q: Why is widget data untrusted, and what is this system's core safety guarantee?**
A: The data ultimately comes from AI tool-call output or knowledge-base content — neither of which is under Freddy's own deterministic control. The core guarantee: there is no expression evaluator anywhere in the render pipeline — the renderer picks from a closed `NODE_TYPES` list and only walks `$bind` paths, never executing a string as code.

**Q: What's the fundamental difference between `{$bind: "$.path"}` and a JS template string?**
A: A template string evaluates an expression — arithmetic, function calls, anything. `$bind` is only a dot/bracket path, which `resolvePath` walks by plain object traversal — no parser, just `.split(".")` and key lookups. There's no room for computation at all.

**Q: How could a prototype pollution attack have come through widget data, and how does the code prevent it?**
A: If the model sent a path like `"$.__proto__.polluted"` and the lookup blindly did `base[key]`, it could reach `Object.prototype`. `resolve.ts` explicitly rejects `__proto__`, `constructor`, and `prototype` segments — and that check lives inside every path lookup, so it can't be bypassed.

**Q: Why don't children mount when `when` is false, and why does that matter?**
A: `RenderNode` checks `when` first — on false it returns `null` immediately, and props are never resolved and children never recursed. So a malformed or missing-data child never even attempts to render unless its parent is visible.

**Q: Why is `repeat` implemented as a separate function instead of returning a single fragment?**
A: If repeat returned a `<>{...}</>` fragment, a parent like `Carousel` that slots children individually would see only "one child" and the whole fragment would land in a single slot (the vertical-stack bug). So `expandRepeat` returns a `ReactElement[]` that merges into the parent's flat children array.

**Q: Does a version mismatch (old definition, new data shape) crash things?**
A: No, the system degrades deliberately. `getWidget` falls back to the latest when the exact version isn't found. An unknown node type yields `null` with just a warning. A missing field makes `resolvePath` return `undefined`, which renders silently empty — "an unresolved binding renders as empty rather than as an error."

**Q: How does `stateBy` make a widget "reconstructible"?**
A: `stateBy` looks up the value of one data field in a `map` to decide which named `states` entry renders. The state is derived from the data, not from local React state — so reopening the conversation replays the stored `data` and deterministically restores exactly the same state.

**Q: To add a new widget primitive, what would you have to touch?**
A: Three places: a new string in `tree.ts`'s `NODE_TYPES`, a React component in `primitives/`, and a mapping in `primitives/index.ts`'s `PRIMITIVES` record. `PRIMITIVES` is typed as `Record<NodeType, ComponentType<...>>` — so if you forget to add the renderer, the TypeScript compile fails rather than silently giving you a blank widget.

### Dashboard App Architecture ([full doc](frontend/05-dashboard-app-architecture.md))

**Q: Why is there no login system in the dashboard — no email/password accounts table?**
A: Because only one operator uses the dashboard in this product — there's no need for multi-user roles or permissions. The comment in `packages/backend/src/auth.ts` says it explicitly: one shared secret is enough; a users table, session store, and login flow would be over-engineering at this scale.

**Q: How does `DashboardAuthGate` verify the password — is there an `/auth/check` endpoint?**
A: No. It directly calls a real gated endpoint, `GET /settings`, and sees whether it succeeds or returns 401. That way there's no dedicated auth-check endpoint to maintain and separately keep in sync with which routes are actually protected — the real route becomes the source of truth.

**Q: What happens if the `DASHBOARD_PASSWORD` env var isn't set on the backend?**
A: The `requireDashboardAuth` middleware calls `next()` straight through without checking any header. So the frontend's first unauthenticated `GET /settings` call succeeds with no key at all, and the gate goes straight to "unlocked" — in local dev this effectively makes auth a no-op, which is intentional.

**Q: Where is the password stored, and how does it persist across reloads?**
A: In `localStorage` under the key `"dashboard-auth-key"`. On a page reload the `useEffect` reads it, sets it into the `packages/api` client via `setDashboardAuthKey()`, and then calls `/settings` to verify it.

**Q: Who attaches the `x-dashboard-key` header to every request, and how?**
A: `packages/api/src/client.ts` holds a module-level `dashboardAuthKey` variable. The `withAuthHeader()` helper merges that header into every request's `init.headers` whenever the key is non-null. The widget never calls `setDashboardAuthKey()`, so for it the key is always `null` and the header is never attached.

**Q: How are the routes organized — all in one file or spread out?**
A: The whole route tree is defined in one place in `App.tsx`, but each route's actual component is imported from its own `modules/<feature>/` folder. That's the feature-folder pattern — route wiring is central, but the implementation is colocated with the feature.

**Q: If you had to add a new protected route (say `/analytics`), what would the steps be?**
A: On the backend, define a new Hono route with the `requireDashboardAuth` middleware. On the frontend, add a new `<Route path="/analytics" .../>` inside `<DashboardLayout>` in `App.tsx`, and create a `modules/analytics/` folder following the pattern. You'd also add an entry to the `customerSupportItems` array in the sidebar.

**Q: When does this auth approach break — name a weakness.**
A: The biggest one: if someone forgets to add the `requireDashboardAuth` middleware when creating a backend route, that route stays silently unprotected — and the `/settings`-based check won't detect it, because `/settings` itself is protected while the other route isn't. (The second edge case — `DASHBOARD_PASSWORD` being unset in production — is covered above; there too there's no hard failure or warning, it just silently opens up.)

**Q: Why does `DashboardAuthGate` return `null` while `status === "checking"` instead of showing a loading spinner?**
A: It's a deliberate simplification — nothing flashes before verification completes (neither the locked form nor the app), which avoids the "flash of locked screen before actually being unlocked" UX glitch. The trade-off is that the user may see a brief blank screen if the `/settings` call is slow.

### Shared UI / Design System ([full doc](frontend/06-shared-ui-design-system.md))

**Q: If shadcn isn't a "component library", what is it?**
A: It's a code generator/CLI. Running `shadcn add <component>` copies that component's full source code into `packages/ui/src/components/` — we become the owners of that code, not locked behind an npm package version.

**Q: What's the difference between Base UI and CVA — don't both look "styling-related"?**
A: Base UI gives zero styling — only behavior and accessibility (focus trap, keyboard nav, ARIA). CVA gives only styling — it organizes Tailwind class strings into named variants (`variant`, `size`), with no behavior. Two independent concerns being composed.

**Q: Why is the `cn()` helper needed — why not just join classes with a template string?**
A: Because Tailwind classes can conflict. `Button`'s default is `bg-primary`; if a caller passes `className="bg-red-500"`, a plain concat sends both classes into the CSS and an unpredictable order wins. `tailwind-merge` understands both target the same property (background-color) and keeps only the last one.

**Q: The `Markdown` component is used in both the chatbot and the dashboard — what's the risk of forking/duplicating it?**
A: The biggest risk: the operator (in the dashboard) and the visitor (in the widget) could see different rendering — citation pills that click through in one place but not the other. The comment says it itself: "Shared verbatim... so an operator sees exactly what a visitor saw." Forking breaks that guarantee silently — the bug wouldn't even be immediately visible.

**Q: The widget (`apps/chatbot`) is a closed shadow DOM custom element. What extra care do shared components need when rendering there?**
A: Shadow DOM gives CSS isolation, which means globals.css (the Tailwind output) has to be injected inside the shadow root too, or the components render unstyled. It's also why `markdown.tsx` uses an `onCitationClick` callback prop instead of native `href="#id"` navigation — hash navigation can't cross the shadow root boundary.

**Q: Why the `oklch()` color space instead of hex/rgb?**
A: Every token in `globals.css` (`--primary`, `--background`, etc.) is in `oklch(L C H)` format — perceptually uniform, meaning the same lightness value looks similarly bright across different hues, which makes dark-mode tuning predictable.

**Q: Without CVA, how much messier would variant management be?**
A: You'd write manual ternaries everywhere (`variant === "outline" ? "..." : ...`), with no type safety and no `defaultVariants` fallback. CVA gives TypeScript the valid union types for variant/size automatically through `VariantProps<typeof buttonVariants>` — passing an invalid variant becomes a compile-time error.

## RAG + Backend

### RAG Ingestion Pipeline ([full doc](rag/07-rag-ingestion-pipeline.md))

**Q: What is RAG and why is it needed?**
A: Retrieving relevant real documents and putting them into the model's context before it answers, so it doesn't guess from training memory. `ingest()` crawls and chunks/embeds the content; `search()` pulls the relevant chunks at query time, which are then given to the chat model.

**Q: Why is `ingest()` an async generator?**
A: An ingest can take minutes, and the dashboard has to show live progress. An async generator yields a typed event at every step (`start`/`page`/`skip`/`unchanged`/`done`/`error`) which streams to the browser over SSE. A plain Promise could only report "finished".

**Q: How does incremental re-ingest work?**
A: After extraction, the new page's SHA-256 hash is compared against the stored `store.pageHash` — on a match, both chunking and embedding are skipped. It sits before chunking because chunking is free while embedding costs money.

**Q: Why sitemap-first crawling?**
A: A sitemap is the site's own statement of "these are my real pages" — link-crawling also picks up tag archives and pagination, which aren't content. Fallback crawling only runs when no sitemap is found.

**Q: What problem does the embedding-model mismatch guard prevent on the ingest side?**
A: Both backends (Google, Ollama) produce 768-dim vectors, so a mismatch wouldn't crash — you'd silently start getting "confidently ranked garbage" results. `ingest.ts` checks this before any crawling or embedding and records the model via `setIndexModel()` — not even a network call goes out on a mismatch. (The same guard exists at search time in `search.ts`, before the query is embedded — defense in depth on both sides.)

**Q: Why is the "prune" option off by default?**
A: A first run, or a run capped by `maxPages`, never reaches the whole site — with prune on, those unreached pages would be treated as "deleted". So it's only turned on explicitly in a scheduled refresh job.

**Q: What happens if two ingest requests arrive for one tenant?**
A: The second doesn't reject the first, it cancels it with `abort()` — "pressing ingest again" almost always means "the URL changed", not "run both".

**Q: What if a page's markdown comes out empty or too short?**
A: `extract()` returns a typed failure (`ok:false`, with reason `"empty"`/`"too-short"`) instead of throwing or storing an empty string — so the developer can see on the dashboard *why* it was skipped.

**Q: Why is the heading-path prefix so important in chunking?**
A: An isolated sentence like "You have 30 days from delivery" is ambiguous. Prepending "Billing > Refunds >" moves the embedding closer to the actual query — the comment itself says this moves recall more than swapping models does.

### RAG Hybrid Search ([full doc](rag/08-rag-hybrid-search.md))

**Q: Why can't you use vector search alone?**
A: It's weak on exact strings — the embedding of a token like an error code or product name doesn't differentiate meaningfully, and one error code lands numerically close to every other error string. Take an example like `SSO_REDIRECT_MISMATCH` — BM25 finds it instantly by exact match while vector search gets confused.

**Q: Why can't you use keyword search alone?**
A: Users ask in their own words, not the docs' exact words — no word in "can I get my money back" matches the "Refunds" page, so keyword-only returns zero results. Vector search captures meaning and handles that case.

**Q: What is RRF (Reciprocal Rank Fusion), and why not a weighted average?**
A: RRF looks only at each result's rank position, not its actual score — the formula is `1 / (60 + rank)`. A weighted average isn't usable because cosine similarity is in the [-1, 1] range while BM25 is unbounded and corpus-dependent — the numbers aren't directly comparable. RRF_K=60 is the value from the original paper and works well without per-corpus tuning.

**Q: Why is the `minSimilarity: 0.35` floor there — is its purpose to improve ranking?**
A: No, its purpose isn't ranking, it's making "I don't know" possible. Vector search always finds some "closest" chunk whether or not the docs cover the topic — without a floor, the model is handed something and confidently builds an answer out of it, which is the most common mechanism behind hallucination.

**Q: Why does the embedding-model mismatch check happen BEFORE embedding the query?**
A: Two reasons — fail fast (if we know there's a mismatch, the embedding round-trip is wasted), and safety: both backends output 768-dimension vectors, so without the check a mismatch silently produces a "confidently ranked list of unrelated passages" — no crash, no empty result, just a wrong answer the model cites as fact.

**Q: What could go wrong if you changed `candidates: 20` to `candidates: 5`?**
A: The fusion pool gets smaller — a chunk that ranks 8th in vector search (outside the top 5) but 2nd in keyword search would never be in the vector list at all with candidates=5, and could only contribute from keyword. The chance of getting a "second opinion" from both retrievers drops, especially for borderline-relevant chunks.

**Q: What is the `via` field (the vector/keyword/both tag) practically good for?**
A: Debugging — a result that's only `via: ["keyword"]` means the embedding model didn't really understand the query, while `via: ["vector"]` tells you the wording was unusual but no keyword matched. It's the fastest way to tell "the embedding is wrong" apart from "the wording is unusual" — a diagnostic signal, not just metadata.

### Backend Chat & AI SDK ([full doc](rag/09-backend-chat-and-ai-sdk.md))

**Q: The widget is "just JavaScript" — why was a backend server needed at all?**
A: Because the widget's bundle loads on the customer's site, where anyone can read everything via view-source. With the key in the widget, it would be stolen within minutes. The backend holds the real key and the widget only talks to it.

**Q: Isn't CORS `origin: "*"` a security hole?**
A: It's deliberate — the widget loads on arbitrary customer domains that aren't known at deploy time, so an allowlist doesn't fit. The real gate should come with auth, which this iteration doesn't have yet.

**Q: `streamText()` vs `generateText()` — what's the difference?**
A: `generateText()` blocks until the full response is ready; `streamText()` exposes chunks in `result.stream` as they arrive from the provider, which is why the client sees a token-by-token reply instead of a blank spinner.

**Q: Why are server tools and client tools in the same `tools` map?**
A: From the model's perspective both are just "callable tools", and the difference shouldn't be visible to it. The real difference is the presence of `execute` — the server tool (`searchKnowledge`) has one, the client tool (`type: "dynamic"`) doesn't, which is why the SDK treats it as an incomplete step and ends the stream.

**Q: What happens if you remove `stopWhen: isStepCount(5)`?**
A: The model stops immediately after a tool call — you get the raw call plus its result, with no explaining sentence built from it.

**Q: What does `repairToolCall` solve, and why is it less necessary in normal apps?**
A: Tool schemas come from the customer's page, and Gemini drops some JSON-Schema keywords when converting them — so the model is following a looser contract. Repair uses a cheap `generateObject()` call to show it the mistake and the correct schema and ask again, so the whole turn doesn't fail.

**Q: Why two separate timeouts — isn't one enough?**
A: They catch different failure modes — `firstChunkMs: 15_000` for a model that never says anything, `totalMs: 120_000` for a stream that trickles forever. A single value couldn't handle both correctly.

**Q: What's the most common mistake when writing a new server tool?**
A: Putting `tenantId` into the tool's `inputSchema` — the model would then be able to "choose" it, and prompt injection could ask for another tenant's data. The `searchKnowledge` pattern is the right one: the constructor takes `tenantId` and binds it in a closure.

**Q: Why doesn't Gemini reject a resumed request containing a client tool call with no result?**
A: `toModelMessages()` expands the turn into 3 messages (call → result → reply) rather than flattening it. A dangling call (one with no result) has its pair dropped, so the provider never rejects it.

### Storage Layer ([full doc](rag/10-storage-layer.md))

**Q: Why build a `Store` interface instead of just using the concrete class directly?**
A: So `ingest.ts`/`search.ts` never know what the underlying DB is. The dev harness runs "clone it and run it" on SQLite, and production switches to Postgres by setting `DATABASE_URL` — without touching pipeline code. Classic dependency inversion.

**Q: Why wasn't `sqlite-vec` used for the dev store?**
A: macOS's system SQLite ships compiled without extension loading, so using sqlite-vec would mean making every developer install SQLite from Homebrew. `better-sqlite3` brings its own bundled binary with FTS5 already in it — the "clone and run" promise stays intact.

**Q: Why isn't brute-force vector search a problem in production (for now)?**
A: A typical docs site is a few thousand chunks, and computing a few thousand dot products (768-dim) takes ~1ms — noise next to the network round trip of the embedding API call. Reaching tens or hundreds of thousands of chunks is the signal to switch to `PgVectorStore`.

**Q: Why is WAL mode explicitly enabled?**
A: In the default journal mode, writes block readers. In WAL, an ingest's write and the dashboard's search read can genuinely run concurrently — it's set in both places.

**Q: When does the in-memory index cache get invalidated?**
A: On every write (`upsertPage`, `deletePage`, `clear`, etc.) it's dropped immediately via `this.indexes.delete(tenantId)` and rebuilt lazily on the next search — so stale vectors are never served.

**Q: Why is the chunk table's key `(tenant_id, id)` rather than just `id`?**
A: A chunk id is `url#position` — unique only within a page. If two tenants crawl the same public docs site they get the same ids; with `id` alone as the key, the second tenant would fail on a UNIQUE constraint.

**Q: What would it take to add a third store?**
A: Write a new class implementing `Store`, and add a third branch in `db.ts` that instantiates it under the right condition. Not one line of `ingest.ts`/`search.ts` has to be touched.

## Top 10 "if they only ask one thing per area" questions

**1. Why is `packages/api` called the "shared wire contract"?** _(Monorepo & Tooling)_
A: It isn't only types — it's runtime validation too. The Zod schemas validate incoming requests in the backend, and the TypeScript types derived from those same schemas are used by both apps at compile time. Add a field and TypeScript breaks whichever half you forgot to update — one single source of truth, with both runtime and compile-time guarantees.

**2. Where do Base UI popups go by default, and how does the widget handle that?** _(Chatbot Widget Embedding)_
A: Into `document.body` by default — outside the shadow boundary, so they'd render unstyled. The fix: `mount()` creates a `fixed`, high-`z-index` div inside the shadow root and provides it to the whole tree through `ShadowContext`, so popups portal there — not into the host page, and not onto the bare shadow root (where the lack of a stacking context would make them paint behind).

**3. Why are there two separate state containers in the chat panel — the Query cache and React state?** _(Chat State & Streaming)_
A: Query is for the settled conversation, which has to survive the panel closing and reopening. The in-flight stream isn't in Query because its `notifyManager` batches notifications — writing every token into the cache coalesced a 7-chunk reply into just 2 paints. So the stream lives in plain `useState`, which re-renders immediately.

**4. Why is widget data untrusted, and what is this system's core safety guarantee?** _(Widget Tree Rendering)_
A: The data ultimately comes from AI tool-call output or knowledge-base content — neither is under deterministic control. The core guarantee: there is no expression evaluator anywhere in the render pipeline — the renderer picks from a closed `NODE_TYPES` list and only walks `$bind` paths, never executing a string as code.

**5. How does `DashboardAuthGate` verify the password — is there an `/auth/check` endpoint?** _(Dashboard App Architecture)_
A: No. It directly calls a real gated endpoint, `GET /settings`, and sees whether it succeeds or returns 401. That way there's no dedicated auth-check endpoint to maintain and separately keep in sync with which routes are actually protected — the real route becomes the source of truth.

**6. If shadcn isn't a "component library", what is it?** _(Shared UI / Design System)_
A: It's a code generator/CLI. Running `shadcn add <component>` copies that component's full source code into `packages/ui/src/components/` — we become the owners of that code, not locked behind an npm package version.

**7. Why is `ingest()` an async generator?** _(RAG Ingestion Pipeline)_
A: An ingest can take minutes, and the dashboard has to show live progress. An async generator yields a typed event at every step (`start`/`page`/`skip`/`unchanged`/`done`/`error`) which streams to the browser over SSE. A plain Promise could only report "finished".

**8. What is RRF (Reciprocal Rank Fusion), and why not a weighted average?** _(RAG Hybrid Search)_
A: RRF looks only at each result's rank position, not its actual score — the formula is `1 / (60 + rank)`. A weighted average isn't usable because cosine similarity is in the [-1, 1] range while BM25 is unbounded and corpus-dependent — the numbers aren't directly comparable. Rank position is the one property that transfers consistently across corpora.

**9. The widget is "just JavaScript" — why was a backend server needed at all?** _(Backend Chat & AI SDK)_
A: Because the widget's bundle loads on the customer's site, where anyone can read everything via view-source. With the Gemini API key in the widget, it would be stolen within minutes. The backend holds the real key and the widget only talks to it — the entire existence of `packages/backend` is justified by that one fact.

**10. Why build a `Store` interface instead of just using the concrete class directly?** _(Storage Layer)_
A: So `ingest.ts`/`search.ts` never know what the underlying DB is. The dev harness runs "clone it and run it" on SQLite, and production switches to Postgres by setting `DATABASE_URL` — without touching pipeline code. Classic dependency inversion, and the whole RAG package's portability rests on that one interface.
