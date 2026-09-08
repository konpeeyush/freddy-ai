# Running this project on Ollama

Use this when `MODEL_PROVIDER=google` isn't an option on a given machine (no
key, or Google's `FAILED_PRECONDITION: User location is not supported for the
API use` — see `apps/server/.env.example`). Ollama runs both the chat model
and the embedding model locally: no key, no network, no per-minute quota.

This project needs two models pulled — one for chat, one for embeddings.
`MODEL_PROVIDER` controls both together (`packages/rag/src/provider.ts`), so
there is nothing to configure per-feature.

## macOS

1. Install Ollama:
   ```bash
   brew install ollama
   ```
   (or download the app from [ollama.com/download](https://ollama.com/download))

2. Start it — either open the Ollama app (it runs in the background and adds a
   menu-bar icon), or run it in a terminal:
   ```bash
   ollama serve
   ```

3. Pull the two models this project uses:
   ```bash
   ollama pull llama3.2:3b        # chat
   ollama pull nomic-embed-text   # embeddings
   ```

4. Confirm it's listening:
   ```bash
   curl http://localhost:11434/v1/models
   ```

## Windows

1. Download and run the installer from
   [ollama.com/download](https://ollama.com/download). It installs Ollama as a
   background service and starts it automatically — no separate `ollama serve`
   step needed.

2. Open a terminal (PowerShell or Command Prompt) and pull the two models:
   ```powershell
   ollama pull llama3.2:3b
   ollama pull nomic-embed-text
   ```

3. Confirm it's listening:
   ```powershell
   curl http://localhost:11434/v1/models
   ```

If the service isn't running (the curl above fails), start it from the Start
Menu (`Ollama`) or run `ollama serve` in a terminal.

## Configuring the server (both platforms)

```bash
cp apps/server/.env.example apps/server/.env
```

Then set, in `apps/server/.env`:

```
MODEL_PROVIDER=ollama
```

`GOOGLE_GENERATIVE_AI_API_KEY` can stay blank — Ollama needs no key. The
defaults already match what was pulled above:

```
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_CHAT_MODEL=llama3.2:3b
# OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Only uncomment and change these if a different model or a non-default Ollama
port is in use.

Then, from the repo root:

```bash
bun install
bun run dev   # server on :8788
```

## One thing to know

Embeddings from Ollama (`nomic-embed-text`) and Google (`gemini-embedding-001`)
are not interchangeable — a knowledge base ingested under one provider cannot
be searched under the other. `search.ts` checks this and throws
`EmbeddingModelMismatch` rather than silently returning nonsense. If a
`rag.db` already exists from ingesting under `MODEL_PROVIDER=google`, switching
to `ollama` means clearing that tenant and re-ingesting — the RAG dev page's
"Clear" button, or `POST /rag/clear`, does this.

`rag.db` itself is gitignored and never travels with the repo (see
`.gitignore`), so a fresh clone on any machine — Ollama or Google — starts
with an empty knowledge base regardless. Ingesting is a one-time step per
machine, not something this file changes.
