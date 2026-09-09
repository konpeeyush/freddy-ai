# Freddy AI — Learnings
_Ek chatbot widget, uska backstage dashboard, aur ek RAG pipeline — poora architecture, chai-pe-charcha wale tareeke se samjhaya gaya._

## Yeh project hai kya

freddy-ai ek AI customer-support product hai jisme do user-facing pieces hain: ek embeddable chat widget (`<freddy-chat>`) jo koi bhi company apni website pe ek `<script>` tag se drop kar sakti hai, aur ek operator dashboard jahan se woh company apne conversations dekhti hai aur apni knowledge base (website ke docs/FAQs) manage karti hai. Dono ek hi Hono backend se baat karte hain, jo Gemini (ya local Ollama fallback) ko call karke replies generate karta hai — aur jawaab dene se pehle apni khud ki RAG (Retrieval-Augmented Generation) pipeline se company ke asli docs mein se relevant chunks nikaal ke model ko deta hai, taaki bot guess na kare, balki asli content se answer de. Poora repo ek pnpm + Turborepo monorepo hai, taaki widget, dashboard, aur backend ek hi shared types (`packages/api`) aur ek hi shared UI kit (`packages/ui`) use karein — bina copy-paste ke.

## Tech stack

| Layer | Technology | Why it's used here |
|---|---|---|
| Monorepo tooling | pnpm workspaces + Turborepo | `pnpm-workspace.yaml` symlinks shared packages instead of publishing them; `turbo.json`'s `dependsOn: ["^build"]` derives build order from the dependency graph and caches `dist/**` |
| Widget app (`apps/chatbot`) | Vite + React 19, native Web Component + closed Shadow DOM | `<freddy-chat>` has to drop into any random customer page without CSS colliding in either direction |
| Dashboard app (`apps/dashboard`) | Vite + React 19 + React Router v6 | Internal single-operator tool — feature-folder routes (`modules/conversations`, `modules/files`, ...) sit behind one shared-password gate |
| Shared UI kit (`packages/ui`) | shadcn (owned source) + Base UI (headless) + CVA + Tailwind v4 | One `Button`/`Dialog`/`Markdown` for both apps — keeps what a visitor sees and what an operator sees in behavior parity |
| Widget-rendering system (`packages/widgets`) | Closed JSON tree walker + fixed primitive registry, no `eval` | Widget data ultimately comes from an LLM/knowledge-base — untrusted — so rendering is only ever lookups, never code execution |
| Backend framework (`packages/backend`) | Hono | Small server holding the only Gemini API key; the widget's bundle runs on customer pages so it can never hold that key itself |
| LLM SDK/provider | Vercel AI SDK `streamText()` + Google Gemini (Ollama fallback) | Token-by-token streaming, `stopWhen`/tool-calling primitives, and a provider-agnostic swap when Google's endpoints hiccup |
| RAG pipeline (`packages/rag`) | Custom crawl → extract → chunk → embed pipeline (sitemap-aware crawler, Readability, turndown) | Turns a live website into searchable chunks; an async-generator design streams live ingest progress to the dashboard |
| Hybrid retrieval | Cosine vector search + BM25 keyword search, fused with Reciprocal Rank Fusion | Vector search alone misses exact strings like error codes; keyword search alone misses natural-language phrasing |
| Storage layer | `Store` interface → `SqliteStore` (better-sqlite3 + FTS5, dev) / `PgVectorStore` (Postgres + pgvector, prod) | Same `ingest()`/`search()` code runs unmodified against either backend — "clone and run" locally, flip `DATABASE_URL` for scale |
| Shared wire contract (`packages/api`) | Zod schemas + typed fetch clients | Backend and both frontends import the same schema — change a field and TypeScript breaks whichever half forgot to update it |

## Padhne ka order

### Frontend
1. [1. Monorepo & Tooling](frontend/01-monorepo-and-tooling.md)
2. [2. Chatbot Widget Embedding](frontend/02-chatbot-widget-embedding.md)
3. [3. Chat State & Streaming](frontend/03-chat-state-and-streaming.md)
4. [4. Widget Tree Rendering](frontend/04-widget-tree-rendering.md)
5. [5. Dashboard App Architecture](frontend/05-dashboard-app-architecture.md)
6. [6. Shared UI / Design System](frontend/06-shared-ui-design-system.md)

### RAG + Backend
7. [7. RAG Ingestion Pipeline](rag/07-rag-ingestion-pipeline.md)
8. [8. RAG Hybrid Search](rag/08-rag-hybrid-search.md)
9. [9. Backend Chat & AI SDK](rag/09-backend-chat-and-ai-sdk.md)
10. [10. Storage Layer](rag/10-storage-layer.md)

## Glossary

- **Monorepo & pnpm workspaces** — ek hi git repo mein dono apps aur saare shared `packages/*` rehte hain; `"workspace:*"` version wale deps ko pnpm real folders pe symlink kar deta hai, koi npm publish nahi chahiye.
- **Turborepo** — task-runner jo `turbo.json`'s `dependsOn: ["^build"]` se build-order derive karta hai aur `outputs: ["dist/**"]` se result cache karta hai; `dev` task cache-off + persistent hai kyunki Vite dev server kabhi khatam nahi hota.
- **Zod** — TypeScript-first schema library; `packages/api/src/schema.ts` mein wire-contract isi se define hai — backend runtime pe requests validate karta hai, dono frontend apps compile-time pe wahi shape import karte hain.
- **Shadow DOM** — browser-native private mini-DOM jo ek element ke saath attach hoti hai apna alag style scope leke; `host.attachShadow({mode:"closed"})` widget ka CSS host page se aur host ka CSS widget se isolate kar deta hai.
- **Custom element / Web Component** — `customElements.define("freddy-chat", ChatWidgetElement)` se browser ko sikhaya jaata hai ki `<freddy-chat>` ka matlab kya hai; koi framework runtime host page pe chahiye hi nahi.
- **Hook** — React ka function jo component ke andar state/lifecycle attach karta hai; `useChat` (`apps/chatbot/src/chat/use-chat.ts`) poore chat panel ka messages/streaming/tools state isi se manage karta hai.
- **Streaming** — poora response ek saath ready hone ka wait nahi, chunks aate hi consume karna; `streamText()` se Gemini ka reply token-by-token backend se widget tak pahunchta hai.
- **SSE (Server-Sent Events)** — backend se browser ko ek-tarafa live events bhejne ka tareeka; `/chat` ka reply-stream aur `/rag/ingest` ke progress events dono isi se aate hain.
- **Embedding** — text ka numeric representation; freddy-ai mein har chunk aur har query 768-number ka `Float32Array` ban jaata hai (`embed.ts`).
- **Vector & cosine similarity** — embedding hi vector hai; cosine similarity do vectors ke beech "meaning kitna similar hai" measure karta hai — isi se `searchVector` top candidates rank karta hai.
- **Hybrid search** — vector search (meaning-based) aur keyword/BM25 search (exact-match-based) dono ek saath chalana; `search.ts` inhe combine karke top 5 chunks return karta hai.
- **RRF (Reciprocal Rank Fusion)** — do ranked lists ko sirf unki rank-position dekh ke fuse karne ka formula (`1/(60+rank)`) — cosine score aur BM25 score directly comparable na hone ki problem yeh solve karta hai.
- **Chunking** — bade document ko chhote, self-contained pieces mein todna; `chunk.ts` markdown headings pe todta hai (character-count pe nahi) aur har chunk ke aage uska heading-path prepend karta hai.
- **RAG (Retrieval-Augmented Generation)** — model ko answer generate karne se pehle relevant real chunks retrieve karke context mein dena, taaki woh training memory se guess na kare — poore `packages/rag` ka yehi purpose hai.
- **LLM** — Gemini (ya local Ollama fallback), `packages/backend`'s `/chat` route jo actually text generate karta hai; widget/dashboard sirf isi ke around bane hain.
- **Tool calling** — model ko ek function call karne dena (jaise `searchKnowledge`) aur uska result usko wapas dena taaki woh us data se answer bana sake; server tools (`execute` hoti hai) aur client tools (browser mein chalti hain) dono ek hi `tools` map mein baithti hain.
- **Hono** — lightweight Node server framework jo `/chat`, `/rag/*`, `/conversations` routes host karta hai — sirf yeh process Gemini API key rakhta hai.
- **TanStack Query** — server-state caching library; settled conversation isi ke cache mein rehti hai (`use-chat.ts`), lekin in-flight streaming ke liye nahi use hota kyunki uska `notifyManager` notifications batch karta hai (per-token updates coalesce ho jaate).
- **shadcn / Base UI / CVA** — teeno milke `packages/ui` banate hain: shadcn component ka source code copy karke deta hai (npm package nahi), Base UI headless accessibility/behavior deta hai (focus trap, ARIA), CVA Tailwind class-strings ko type-safe named variants mein organize karta hai.
- **SQLite FTS5 & pgvector** — dono `Store` interface implement karte hain — dev mein `better-sqlite3`'s bundled FTS5 (keyword search) + brute-force cosine, production mein Postgres ka `pgvector` extension (`<=>` operator se vector search); same `search.ts`/`ingest.ts` code dono pe unmodified chalta hai.
- **Hallucination** — model ka confidently kuch galat/bana hua bol dena; `minSimilarity: 0.35` floor (`search.ts`) isi ko rokta hai — bina achhe match ke, "I don't know" ek reachable outcome banta hai, chunk force-feed nahi hota.

## Interview prep

Saare 10 topics ke interview questions ek jagah consolidate kiye hain — [interview-prep.md](interview-prep.md) mein dekho.
