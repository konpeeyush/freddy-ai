# freddy-ai

An embeddable AI chat widget plus the operator dashboard around it: a knowledge-base-backed
support bot (`apps/chatbot`) and an inbox + knowledge-base manager for the humans behind it
(`apps/dashboard`), sharing one Node/Hono backend and one "base-maia" shadcn component
language.

## Packages

- `apps/chatbot` — the embeddable widget (`<freddy-chat>`, closed shadow DOM) and its local dev/preview harness.
- `apps/dashboard` — the operator UI: conversations inbox and knowledge-base management.
- `packages/backend` — Hono server: chat, RAG, conversations, documents.
- `packages/rag` — crawl/extract/chunk/embed/search pipeline and its sqlite store.
- `packages/api` — the shared Zod wire contract and fetch clients used by both apps and the backend.
- `packages/widgets` — the rich-card widget primitive system tool replies can render.
- `packages/ui` — the shared shadcn/Base UI component library ("base-maia" style).

## Development

```bash
pnpm install
pnpm dev
```

This starts the backend (`:8788`), the chatbot dev harness, and the dashboard concurrently.

## Adding UI components

```bash
pnpm dlx shadcn add <component> -c apps/dashboard
```

Components land in `packages/ui/src/components` and are imported as `@workspace/ui/components/<name>`.
