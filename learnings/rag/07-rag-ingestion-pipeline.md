# RAG Ingestion Pipeline
_"Reading" a website and turning it into a searchable knowledge base_

## What is this?

This is the pipeline that crawls a company's website, pulls out its text, breaks it into small pieces, converts those pieces into "vectors" (arrays of numbers), and stores them in a database. Later, when a user asks the chatbot a question, the most relevant of those stored pieces are pulled out and handed to the AI model — so the model answers from the real website's text instead of guessing from memory.

All of it is orchestrated inside the `ingest()` function in `packages/rag/src/ingest.ts` — crawl → extract → chunk → embed → store, in that order.

## Why it exists

The point of RAG (Retrieval-Augmented Generation) is this: ask an LLM directly "what's my refund policy" and it can confidently make something up — because it has never read your actual docs. The solution: read the website/docs ahead of time, store them as small pieces, and when a question comes in, retrieve the most relevant pieces and give them to the model as context.

The comment at the top of the file already explains why `ingest()` is an `async function*` (an async generator) rather than a plain async function:

```ts
// packages/rag/src/ingest.ts:1-13
* An ingest takes minutes, and the playground's whole value is
* watching where it goes wrong — which pages were skipped, how many chunks a
* page produced, whether the crawler found a sitemap at all. A promise that
* resolves at the end can only report that it finished.
```

In other words: an ingest can take minutes for a website. A plain Promise could only report "finished"; the developer needs to see which page was skipped and why, and how many chunks were produced — so an **event is yielded** at every step, in real time.

## How it works, step by step

1. **A model safety check first** — before the crawl starts, `ingest()` checks which embedding model the tenant's existing index was built with (`store.indexModel`). If the config's model differs, it yields an `error` event and stops right there (`ingest.ts:72-80`) — not even a network request goes out.

2. **Crawl** (`crawl.ts`) — it looks for a sitemap first (from `robots.txt` or standard locations). If found, trust it, because the sitemap is the site itself saying "these are my pages" — whereas link-crawling also picks up tag archives, pagination, and print views. Link-crawling is the fallback only when no sitemap is found. There's a `delayMs` (150ms) politeness gap and a `maxPages` hard cap (default 100) so the bill doesn't blow up.

3. **Extract** (`extract.ts`) — pull the real content out of raw HTML. A docs page is mostly 85% chrome (nav, sidebar, footer) — embed that and every chunk's vector drifts toward that chrome, making search useless. Mozilla's `Readability` (the Firefox Reader Mode algorithm) + `linkedom` (a lightweight in-Node DOM) + `turndown` (HTML → markdown) do the cleaning. FAQ Q/A pairs are extracted separately here too.

4. **Hash check — the cheap skip** — the new page's content hash is compared against the previously stored hash. On a match it's marked "unchanged" and skipped — no chunking or embedding at all. This check sits *before* chunking because chunking is free while embedding costs money.

5. **Chunk** (`chunk.ts`) — split on markdown headings (not on character count), because a heading is a natural boundary. Each chunk gets its "heading path" prepended (like "Billing > Refunds") so the chunk is meaningful on its own.

6. **Embed** (`embed.ts`) — each chunk's text is converted into a 768-number vector, in batches of 96.

7. **Store** — `store.upsertPage()` saves the page and its chunks (with embeddings) into the DB.

8. **Optional prune** — with `prune: true`, pages not seen in the crawl are removed from the DB. Off by default.

9. **Done event** — a summary: pages, chunks, skipped/unchanged/removed, tokens, total time.

## Code walkthrough

- **`ingest.ts:72-80`** — the model-mismatch guard, before any crawling or embedding:
  ```ts
  const model = embeddingModelId()
  const stored = await store.indexModel(options.tenantId)
  if (stored && stored !== model) {
    yield { kind: "error", message: `...built with ${stored}, but ${model} is configured now` }
    return
  }
  ```
  Both models (Google, Ollama) produce the same 768-dim vectors (`embed.ts:18`), so a mismatch wouldn't crash — it would quietly give wrong results.

- **`ingest.ts:98-104`** — the hash comparison before chunking: `if ((await store.pageHash(...)) === page.hash) { unchanged++; continue }`.

- **`crawl.ts:275-279`** — `crawl()` is itself an async generator — extract/chunk/embed start as soon as a page arrives, so 100 pages of HTML are never buffered in memory.

- **`extract.ts:59-78`** — the `STRIP` list holds the selectors Readability sometimes keeps (nav, `.sidebar`, `.cookie`) — they're forcibly removed.

- **`chunk.ts:230-236`** — `embeddable()` builds the text that gets embedded (breadcrumb + text) — what's given to the model is different; the breadcrumb is only there for retrieval.

- **`backend/src/rag.ts:56-60`** — one tenant, one ingest: `running.get(tenantId)?.abort()` and then the new controller is set — starting a new one cancels the old.

## Diagram

The diagram below (`07-rag-ingestion-pipeline.excalidraw`) shows the pipeline left to right: "Website URL" → "Crawl" (sitemap-aware) → "Extract" (clean markdown + FAQs via Readability + turndown) → a decision diamond "Hash same as before?" where the "Yes" path arcs over the top straight to "Done" (chunk+embed skipped — cheap!) and the "No" path goes through "Chunk" → "Embed" → "Store" to "Done". A separate "Dashboard" box connects back to the pipeline with a dashed arrow labeled "SSE progress events" — the backend streams live events to the dashboard. Colors distinguish the stages: input orange, crawl/embed/store blue, extract/done purple, chunk/store green, decision yellow, dashboard pink. Load the file on excalidraw.com via File → Open, or drag it onto the canvas.

## Interview questions

**Q: What is RAG and why is it needed?**
A: Retrieving relevant real documents and putting them into the model's context before it answers, so it doesn't guess from training memory. `ingest()` crawls and chunks/embeds the content; `search()` pulls the relevant chunks at query time, which are then given to the chat model.

**Q: Why is `ingest()` an async generator?**
A: An ingest can take minutes, and the dashboard has to show live progress. An async generator yields a typed event at every step (`start`/`page`/`skip`/`unchanged`/`done`/`error`) which streams to the browser over SSE (`backend/src/rag.ts:67-98`).

**Q: How does incremental re-ingest work?**
A: After extraction, the new page's SHA-256 hash is compared against the stored `store.pageHash` — on a match, both chunking and embedding are skipped (`ingest.ts:98-104`). It sits before chunking because chunking is free while embedding costs money.

**Q: Why sitemap-first crawling?**
A: A sitemap is the site's own statement of "these are my real pages" — link-crawling also picks up tag archives and pagination, which aren't content (`crawl.ts:4-7`). Fallback crawling only runs when no sitemap is found.

**Q: What problem does the embedding-model mismatch guard prevent?**
A: Both backends (Google, Ollama) produce 768-dim vectors (`embed.ts:18`), so a mismatch wouldn't crash — you'd silently start getting "confidently ranked garbage" results. `ingest.ts:72-80` checks this before any crawling or embedding, and records the model via `setIndexModel()`.

**Q: Why is the "prune" option off by default?**
A: A first run, or a run capped by `maxPages`, never reaches the whole site — with prune on, those unreached pages would be treated as "deleted" (`ingest.ts:41-44`). So it's only turned on explicitly in a scheduled refresh job.

**Q: What happens if two ingest requests arrive for one tenant?**
A: The second doesn't reject the first, it cancels it with `abort()` (`backend/src/rag.ts:56-60`) — "pressing ingest again" almost always means "the URL changed", not "run both".

**Q: What if a page's markdown comes out empty or too short?**
A: `extract()` returns a typed failure (`ok:false`, with reason `"empty"`/`"too-short"`) instead of throwing or storing an empty string — so the developer can see on the dashboard *why* it was skipped.

**Q: Why is the heading-path prefix so important in chunking?**
A: An isolated sentence like "You have 30 days from delivery" is ambiguous. Prepending "Billing > Refunds >" moves the embedding closer to the actual query (`chunk.ts:10-15`) — the comment itself says this moves recall more than swapping models does.

## Common confusions

- People read `ingest()` as a "it's running, just wait" function — it's actually an event stream you consume with `for await`; the backend wraps it in SSE, not a single JSON response.
- "Unchanged" and "skip" are different — unchanged means the hash matched (the page didn't change), while skip means extraction failed or no chunks were produced at all.
- People read prune being off by default as a bug when old pages aren't deleted — it's actually a deliberate safety measure, to prevent data loss from a partial crawl.
- The hash comparison happens *before chunking*, not just before embedding — subtle, because chunking is work too, but chunking is free and embedding is paid.
