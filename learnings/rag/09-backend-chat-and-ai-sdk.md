# Backend + Vercel AI SDK
_How to stream from an LLM and run tools — without leaking the API key_

## What is this?

`packages/backend` is a Hono server whose core route is `POST /chat`. It calls Gemini (or a local Ollama) via the Vercel AI SDK's `streamText()`, streams the reply token by token, and along the way lets the model call "tools" (functions) — like searching its own knowledge base. The widget in the browser never calls the LLM directly; it always goes through this backend.

## Why it exists

The widget's bundle loads on the **customer's website** — whatever is inside that JS is instantly readable via view-source/devtools. Put the Gemini key in the widget and it'll be stolen within minutes. The backend is a trusted middleman: only it holds the key, and the widget only ever talks to it. That reasoning is written into the code:

```ts
/*
 * Exists because the API key cannot ship in the widget — that bundle runs on
 * customers' pages, where anything in it is readable. The widget talks to
 * this; this talks to Gemini.
 */
```
`packages/backend/src/index.ts:61-63`

CORS `origin: "*"` is deliberately open for the same reason — the widget can load on any customer domain, unknown ahead of time, so a per-origin allowlist doesn't fit (`packages/backend/src/index.ts:169-172`).

## How it works, step by step

1. **A request arrives at `/chat`** and is validated against a Zod schema — invalid gets a 400, a missing key gets a 500 (`index.ts:432-450`).
2. **The system prompt is assembled**: the base `SYSTEM_PROMPT` + the operator's persona/restrictions + this turn's `turnInstruction`, all additive via `.join("\n\n")` — so whatever the operator writes, the citation/no-fabrication rules always still apply (`index.ts:456-471`).
3. **The model is chosen**: `chatModel()` (`model.ts`) returns `google(id)` or Ollama depending on the provider — Ollama is the fallback because Google's endpoints return `FAILED_PRECONDITION` on some networks depending on IP.
4. **`streamText()` is called** — it doesn't wait for the full reply; `result.stream` starts producing chunks immediately.
5. **Tools come from two sources**: server tools via `resolveTools()` (currently just `searchKnowledge`) and page-defined tools via `clientTools()` — both spread into one `tools` object (`index.ts:499-507`).
6. **The model can call a tool.** `searchKnowledge` runs its `execute()` right here on the backend (neither the provider key nor the RAG store can live in the browser). A client tool has no `execute` — the SDK treats it as an "unfinished step": the call is emitted, the stream **ends** right there, the browser runs the handler, and sends the result back in the next request.
7. **`stopWhen: isStepCount(5)`** — without it the model would stop immediately after a tool call; this gives it internal steps so `{ celsius: 31 }` can become "It's 31°C in Delhi."
8. **`repairToolCall()`** tries one cheap extra round-trip when a call doesn't match the schema — more necessary here because customers write the schemas and Gemini silently drops some JSON-Schema keywords in its own dialect.
9. **`smoothStream()` + `Intl.Segmenter(word)`** paces tokens server-side — a client-side space-splitting timer would dump an entire reply in one frame for Chinese/Japanese/Thai (scripts without spaces), while Segmenter knows the real word boundaries of every script.
10. **Two timeouts**: `firstChunkMs: 15_000` (the model never says anything) and `totalMs: 120_000` (a stream that trickles forever) — they catch different failures, plus `maxRetries: 1`.
11. **The response goes out through `toUIMessageStream()`/`createUIMessageStreamResponse()`** as typed parts (text-delta, tool-call, tool-result, error) — not plain text, because a tool call can't be represented in a string.

## Code walkthrough

- **`index.ts:499-507`** — both tool sources merged into one map:
  ```ts
  tools: {
    ...resolveTools(tenantId, parsed.data.tools),
    ...clientTools(parsed.data.clientTools),
  },
  ```
  To the model both look like "the same kind of tool"; the only difference is the presence or absence of `execute`.
- **`tools/client.ts:33-53`** — a client tool is built with `type: "dynamic"`, with `execute` deliberately missing — the comment: "AI SDK treats a tool it cannot execute as a step it cannot finish."
- **`tools/index.ts:43-70`** — `searchKnowledge` is built by a per-request function (with `tenantId` bound in a closure) rather than existing as an instance — so one tenant's running ingest can't override another's, and so `tenantId` never appears in the model's `inputSchema` (otherwise the model could "name" another tenant and ask for its data).
- **`repair.ts:32-66`** — `repairToolCall` gets bad arguments fixed by a separate `generateObject()` call; if the name itself is wrong (`NoSuchToolError`) it returns null — rewriting arguments doesn't fix a wrong name.
- **`history.ts:53-135`** — `toModelMessages()` expands a tool-call turn into **3 messages** (assistant call → tool result → assistant reply) rather than flattening it — Gemini rejects a call-without-result in a resumed request.
- **`packages/api/src/schema.ts:293-322`** — the frontend's `StreamEvent` narrows raw SSE parts (`text-delta`, `tool-input-available`, `tool-output-available`) into simple `kind`s: `text`, `tool-start`, `tool-end`, `client-tool-call`, `widget`.

## Diagram

The diagram (`09-backend-chat-and-ai-sdk.excalidraw`) shows how a request flows: `POST /chat` goes from "Widget (browser)" to the "Hono server", which calls "Gemini / Ollama" through `streamText()` — and the response arrow heads back toward the widget labeled "typed stream: text-delta / tool-call / tool-result / widget". Two side notes ("stopWhen" and "repairToolCall") sit near the model box. Below, a "tools map" box splits into two branches — "Server tool: searchKnowledge" (executes right here) and "Client tool" (no execute, stream ends immediately). A red loop-back arrow curves from the client-tool box back to the widget, labeled "resumes on next request with the result".

## Interview questions

**Q: The widget is "just JavaScript" — why was a backend server needed at all?**
A: Because the widget's bundle loads on the customer's site, where anyone can read everything via view-source. With the key in the widget, it would be stolen within minutes. The backend holds the real key and the widget only talks to it (`index.ts:61-63`).

**Q: Isn't CORS `origin: "*"` a security hole?**
A: It's deliberate — the widget loads on arbitrary customer domains that aren't known at deploy time, so an allowlist doesn't fit. The real gate should come with auth, which this iteration doesn't have yet (`index.ts:169-172`).

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
A: Putting `tenantId` into the tool's `inputSchema` — the model would then be able to "choose" it, and prompt injection could ask for another tenant's data. The `searchKnowledge` pattern is the right one: the constructor takes `tenantId` and binds it in a closure (`tools/index.ts:43-70`).

**Q: Why doesn't Gemini reject a resumed request containing a client tool call with no result?**
A: `toModelMessages()` expands the turn into 3 messages (call → result → reply) rather than flattening it. A dangling call (one with no result) has its pair dropped, so the provider never rejects it.

## Common confusions

- "Client tool" gets read as "there's already a dummy implementation in the widget" — in reality there is **no** implementation on the server at all; execution happens in the browser.
- `smoothStream` isn't client-side throttling — it's server-side pacing, so it works correctly in every language (both spaced and space-less scripts).
- `stopWhen` (a limit on steps) and `toolChoice` (whether a tool call is forced this turn) are different things, and people mix them up.
- A retrieval failure doesn't crash the server — `searchKnowledge` catches `EmbeddingModelMismatch` and hands the model a "note" text instead, so the whole turn doesn't fail.
