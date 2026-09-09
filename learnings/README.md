# Freddy AI — Learnings
_A chatbot widget, its backstage dashboard, and a RAG pipeline — the whole architecture, explained the way you'd explain it over a cup of coffee._

## What is this project

freddy-ai is an AI customer-support product with two user-facing pieces: an embeddable chat widget (`<freddy-chat>`) that any company can drop onto its website with a single `<script>` tag, and an operator dashboard where that company reviews its conversations and manages its knowledge base (the site's docs/FAQs). Both talk to the same Hono backend, which calls Gemini (or a local Ollama fallback) to generate replies — and before answering, it pulls the relevant chunks out of the company's real docs through its own RAG (Retrieval-Augmented Generation) pipeline and hands them to the model, so the bot answers from actual content instead of guessing. The whole repo is a pnpm + Turborepo monorepo, so the widget, the dashboard, and the backend all share one set of types (`packages/api`) and one UI kit (`packages/ui`) — with no copy-paste.

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

## Reading order

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

- **Monorepo & pnpm workspaces** — both apps and every shared `packages/*` live in one git repo; pnpm symlinks any dep with a `"workspace:*"` version to the real folder, so nothing has to be published to npm.
- **Turborepo** — a task runner that derives build order from `turbo.json`'s `dependsOn: ["^build"]` and caches results via `outputs: ["dist/**"]`; the `dev` task is cache-off and persistent because a Vite dev server never exits.
- **Zod** — a TypeScript-first schema library; the wire contract in `packages/api/src/schema.ts` is defined with it — the backend validates requests at runtime, and both frontend apps import the same shape at compile time.
- **Shadow DOM** — a browser-native private mini-DOM attached to an element, with its own style scope; `host.attachShadow({mode:"closed"})` isolates the widget's CSS from the host page and the host's CSS from the widget.
- **Custom element / Web Component** — `customElements.define("freddy-chat", ChatWidgetElement)` teaches the browser what `<freddy-chat>` means; no framework runtime is needed on the host page at all.
- **Hook** — a React function that attaches state/lifecycle inside a component; `useChat` (`apps/chatbot/src/chat/use-chat.ts`) manages the whole chat panel's messages/streaming/tools state.
- **Streaming** — consuming chunks as they arrive instead of waiting for the full response; `streamText()` carries Gemini's reply token by token from the backend to the widget.
- **SSE (Server-Sent Events)** — a way to push one-way live events from the backend to the browser; both `/chat`'s reply stream and `/rag/ingest`'s progress events come through it.
- **Embedding** — a numeric representation of text; in freddy-ai every chunk and every query becomes a 768-number `Float32Array` (`embed.ts`).
- **Vector & cosine similarity** — an embedding *is* a vector; cosine similarity measures how close two vectors are in meaning — that's what `searchVector` ranks its top candidates by.
- **Hybrid search** — running vector search (meaning-based) and keyword/BM25 search (exact-match-based) together; `search.ts` combines them and returns the top 5 chunks.
- **RRF (Reciprocal Rank Fusion)** — a formula (`1/(60+rank)`) that fuses two ranked lists using only rank position — it sidesteps the problem that cosine scores and BM25 scores aren't directly comparable.
- **Chunking** — splitting a large document into small, self-contained pieces; `chunk.ts` splits on markdown headings (not on character count) and prepends each chunk's heading path to it.
- **RAG (Retrieval-Augmented Generation)** — retrieving relevant real chunks and putting them in the model's context before it generates an answer, so it doesn't guess from training memory — that's the entire purpose of `packages/rag`.
- **LLM** — Gemini (or the local Ollama fallback), reached through `packages/backend`'s `/chat` route, which is what actually generates text; the widget and dashboard are just built around it.
- **Tool calling** — letting the model call a function (like `searchKnowledge`) and handing the result back so it can answer from that data; server tools (which have an `execute`) and client tools (which run in the browser) both sit in the same `tools` map.
- **Hono** — the lightweight Node server framework hosting the `/chat`, `/rag/*`, and `/conversations` routes — this is the only process that holds the Gemini API key.
- **TanStack Query** — a server-state caching library; the settled conversation lives in its cache (`use-chat.ts`), but it isn't used for in-flight streaming because its `notifyManager` batches notifications (per-token updates would coalesce).
- **shadcn / Base UI / CVA** — together they make up `packages/ui`: shadcn hands you a component's source code (not an npm package), Base UI provides headless accessibility/behavior (focus trap, ARIA), and CVA organizes Tailwind class strings into type-safe named variants.
- **SQLite FTS5 & pgvector** — both implement the `Store` interface — in dev, `better-sqlite3`'s bundled FTS5 (keyword search) plus brute-force cosine; in production, Postgres's `pgvector` extension (vector search via the `<=>` operator); the same `search.ts`/`ingest.ts` code runs unmodified on either.
- **Hallucination** — the model confidently stating something wrong or made up; the `minSimilarity: 0.35` floor (`search.ts`) guards against it — without a good match, "I don't know" becomes a reachable outcome instead of a chunk being force-fed.

## Interview prep

Interview questions for all 10 topics are consolidated in one place — see [interview-prep.md](interview-prep.md).
