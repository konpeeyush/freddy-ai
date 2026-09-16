# The Freddy AI Story
_How to actually tell this project in an interview — not the Q&A bank (that's [interview-prep.md](interview-prep.md)), but the narrative underneath it: the problem, the two hard bets, the scars, and how to steer the conversation._

Every other doc in this folder is dry on purpose — code, line numbers, "why". This one is the same material laid out as something you'd say out loud, not read off a page.

---

## The 30-second version (open with this)

"I built an AI support widget — an embeddable chat panel backed by retrieval rather than a general-purpose model. A company drops in one `<script>` tag, points it at their own docs, and visitors get answers grounded in that company's actual content instead of a model's best guess. The two hardest problems were: getting a React app to run correctly inside a host page you don't control, and getting the bot to answer from real documents instead of confidently inventing plausible-sounding wrong answers. Everything else in the system exists in service of those two problems."

That's the whole pitch. Everything below is what backs it up when they start pulling threads.

---

## The problem, before any code

Picture a small SaaS company. Support tickets pile up, most of them answerable from docs that already exist — a refund policy page, a "how do I reset my API key" FAQ, a billing FAQ. Two bad options already exist:

- **A generic chatbot** — fast to ship, but it answers from whatever the underlying model happened to learn during training. Ask it your refund policy and it invents something plausible-sounding and wrong.
- **A search box over the docs** — accurate, but rigid. Users don't type doc titles, they type "can I get my money back," which shares zero words with a page called "Refunds."

The interesting engineering isn't "call an LLM." It's building the bridge between those two options — retrieval that's actually good, wrapped in a UI that can live anywhere — without either the bot lying or the widget breaking the host page it's running in.

That framing is the spine of the whole story: **two hard bets, taken on purpose.**

---

## Chapter One — Shadow DOM isolation, and what the platform doesn't cover

An embeddable widget's React app has to run inside a page it doesn't control, wasn't built by the same team, and could be running anything — WordPress, a legacy jQuery site, another company's own aggressive global CSS reset.

Mounting a plain `<div>` and rendering React into it breaks in both directions immediately: the host's CSS reaches in and repaints the widget's elements, and the widget's CSS leaks out and repaints the host's.

The fix is a browser feature most engineers know exists but few have had a reason to reach for: **Shadow DOM**. `host.attachShadow({ mode: "closed" })` gives the widget a private DOM subtree with its own style scope, which neither side's CSS can cross. Closed mode specifically, not open — open mode still lets the host page's own JavaScript reach in through `element.shadowRoot`; closed means that property just returns `null`. It's a styling boundary and a small security boundary at the same time.

That would be the end of it if the UI library cooperated, but it doesn't — the component library portals its popups (dropdowns, dialogs, tooltips) into `document.body` by default, which is outside the shadow boundary. The first dropdown that opened rendered in the DOM, technically present, and completely unstyled, because the stylesheet it needed only exists inside the shadow root. The fix: build a `fixed`, high-z-index layer *inside* the shadow root at mount time, and hand every component in the tree a reference to it through context, so every popup portals there instead of to `document.body`. That's the kind of bug that only surfaces when you actually exercise the popup path, not something the Shadow DOM spec would warn you about.

A related platform constraint: a shadow root, once attached to an element, can never be moved to a different element. That's not a bug to route around — it's just a fact about the platform. So when the widget's *shape* changes (inline panel vs. floating bubble vs. fullscreen), the code doesn't try to migrate the existing root — it swaps in a fresh element and remounts. Theme changes, by contrast, are cheap: a `data-theme` attribute flip on the existing root, no remount needed. The two look similar from the outside; knowing which category a given change falls into is the actual point.

**One-sentence version:** "The interesting part of Shadow DOM isn't 'use Shadow DOM for isolation' — that's well known. It's that your own popup library doesn't know your isolation boundary exists, and you have to build the escape hatch for it yourself."

---

## Chapter Two — RAG: making the model answer from real documents

Start with the failure mode, because that's what makes RAG a real idea instead of a buzzword: ask a raw LLM "what's your refund policy" and it answers fluently, confidently, and often wrong — because it never read this company's actual refund policy. It's pattern-completing from training data, not looking anything up.

RAG (Retrieval-Augmented Generation) fixes this: **read the real content ahead of time, store it in searchable pieces, and at question time hand the model the relevant pieces as context before it's allowed to answer.** The model isn't asked to know the refund policy — it's asked to read three retrieved paragraphs of it and summarize.

Getting there is a pipeline with real decisions at every stage:

- **Crawl.** Trust the site's own sitemap first — it's the site's own statement of "these are my real pages." A link-crawler left to itself will also index tag archives and pagination pages that aren't content at all.
- **Extract.** A raw docs page is mostly chrome — nav bars, sidebars, footers, cookie banners. Embedding that indiscriminately drifts every chunk's vector toward "generic website furniture" instead of the actual content, and search quality quietly degrades. Mozilla's Readability library — the algorithm behind Firefox's Reader Mode — strips that chrome out before anything gets chunked.
- **Chunk.** Split on markdown headings, not a fixed character count — a heading is a real semantic boundary, a character count is arbitrary. Prepend each chunk with its heading path ("Billing > Refunds") before embedding: a lone sentence like "you have 30 days from delivery" is ambiguous on its own, but with the heading path prepended the embedding lands measurably closer to how someone would actually ask the question. That one prefix does more for search quality than swapping embedding models does.
- **Embed, but skip it when possible.** Before chunking even happens, a cheap content hash is compared against what's already stored. Unchanged content skips straight to "unchanged" — no chunking, no embedding. The ordering matters: chunking is free, embedding costs real API calls, so the expensive step is the one guarded by the cheap check, not the other way around.
- **Report progress, not just completion.** A full-site crawl can run for minutes; a plain `Promise` can only report "done." So `ingest()` is written as an async generator — it yields a typed event at every step (page crawled, page skipped, page unchanged, error) that streams live to the dashboard over SSE. The value of watching an ingest is seeing *where* it went sideways while it's happening, not just the final count.

**One-sentence version:** "RAG sounds like one idea — retrieve, then generate — but almost all the actual engineering is upstream of that, in making sure what gets stored is clean, boundary-aware, and cheap to keep fresh."

---

## Chapter Three — Hybrid search: combining vector and keyword retrieval

Once content is indexed, the obvious next move is "embed the user's question, find the closest vectors, done." That works — until someone pastes an error code.

Vector search finds semantic similarity. Ask it "how do I get a refund" and it correctly lands near the refunds page even though the wording doesn't match. But hand it `SSO_REDIRECT_MISMATCH` and it has no real signal to work with — that token is numerically about as close to every other error string on the site as it is to the one that actually matters. Keyword search (BM25) finds that exact string instantly, but ask it "can I get my money back" and it returns nothing, because that sentence doesn't share a single word with a page titled "Refunds."

Neither retriever is wrong — they operate on different signals: dense semantic similarity versus exact lexical overlap. So the system runs both, in parallel, over the same query, and fuses the two ranked lists with **Reciprocal Rank Fusion**: each result's score becomes `1 / (60 + its rank position)`, and if a chunk shows up in both lists, both contributions add together. The fusion is rank-based rather than a weighted average of raw scores because the two numbers were never comparable — cosine similarity lives in [-1, 1], BM25 is unbounded and depends on the size of the corpus it's scored against. Rank position is the one thing that transfers cleanly across both.

The more consequential design decision here is the **similarity floor**. Vector search always returns *something* — it always has a "closest" vector, whether or not anything in the index is actually relevant. Left unguarded, the model gets handed a plausible-looking but irrelevant chunk and confidently builds an answer out of it anyway — the most common mechanism behind hallucination in RAG systems. A hard floor (`minSimilarity: 0.35`) discards anything below that bar, which means "I don't have a good answer for that" becomes a reachable outcome instead of something the system can never say. That's a deliberate design choice, not a missing feature.

**One-sentence version:** "The floor isn't there to improve ranking — it's there to make 'I don't know' a valid answer. Most hallucination isn't the model lying, it's the retrieval layer handing it garbage and the model being too polite to say so."

---

## Chapter Four — Rendering untrusted tool output safely

Tool calls don't just return text — they can hand back a rich card: a pricing table, an order-status widget, a carousel of docs. That data is rendered as a tree of typed nodes. Worth naming plainly: that tree's content ultimately comes from an LLM's tool output, or from knowledge-base content — neither is under deterministic control. Rendering it is, structurally, rendering untrusted input.

The core guarantee that makes that safe: **there is no expression evaluator anywhere in the render path.** The renderer only ever does two things — pick a component from a closed, fixed list of node types, and resolve a `$bind` path by plain dot-notation object traversal. No `eval`, no template-string interpolation, nothing that turns a string into executable logic. A malformed `$bind` path like `"$.__proto__.polluted"` is explicitly rejected at the path-resolution layer, because that's the one place every lookup has to pass through.

The security decision worth stating clearly here isn't a clever defense — it's the absence of a whole class of attack surface by construction.

---

## Chapter Five — Why there's a backend at all

Worth planting this question yourself, because it's the kind of thing a sharp interviewer asks: *"the widget is just JavaScript running in the browser — why do you need a server at all?"*

Because the widget's bundle runs on a customer's website, where anyone can open dev tools and read every line of it via view-source. If the AI provider's API key lived in that bundle, it would be public within minutes of the first page load. The entire existence of the backend is justified by that one fact: it's the only process that ever holds the real key, and the widget only ever talks to *it*.

That framing also explains a decision that looks sloppy until you hear the reasoning: CORS is wide open (`origin: "*"`). That's deliberate, not an oversight — the widget can be embedded on any customer's domain, and those domains aren't known at deploy time, so a fixed allowlist doesn't fit the shape of the product. The real access control is meant to live in auth, which is a known, named gap in this iteration rather than an accident — worth saying plainly if asked, because pretending otherwise is worse than owning it.

---

## Chapter Six — A storage layer that scales from SQLite to Postgres

Two audiences need two different things from storage. A developer cloning the repo needs "install, run, it works" — no external database to stand up. Production needs to survive real traffic and scale past what a single SQLite file comfortably handles.

The resolution is a `Store` interface that `ingest()` and `search()` code against, with zero knowledge of what's underneath. Locally, that's `better-sqlite3` with its bundled FTS5 extension for keyword search, plus a brute-force cosine scan for vector search — genuinely fine at the scale of a single doc site, a few thousand chunks, where a few thousand dot products cost roughly a millisecond, dwarfed by the network round-trip to the embedding API anyway. Flip one environment variable (`DATABASE_URL`) and the exact same pipeline code runs against Postgres with the `pgvector` extension instead. Not one line of `ingest.ts` or `search.ts` needs to know or care which one is live.

**One-sentence version:** "It's a fairly standard dependency inversion, but the reason it mattered here specifically is that 'clone and run instantly' and 'scale in production' are usually in tension, and this is the seam where that tension gets resolved without duplicating the pipeline."

---

## The honest scars — what's still rough

A system described with zero flaws stops being convincing. These are real, named gaps — say them plainly if asked "what would you improve":

- **Auth is a known gap, not a solved problem.** CORS is wide open by necessity (see Chapter Five), and the real access boundary — proper request auth — hasn't been built yet. It's a deliberate sequencing choice (ship the product, then harden it), and it's the first thing that should change before this handles anything sensitive.
- **The dashboard has one shared password, not real accounts.** Fine for a single operator; wouldn't survive a second person needing their own audit trail or scoped permissions.
- **Brute-force vector search has a ceiling.** It's genuinely fine at a few thousand chunks, but it's a linear scan — it doesn't fail gracefully, it just gets slower. The honest answer is "we'd know it's time to switch to Postgres/pgvector in production when a tenant's doc site gets large enough that this becomes visible," not because of a monitored threshold that trips automatically today.
- **No re-ranking model.** RRF is a strong, cheap, corpus-agnostic fusion strategy, but a learned re-ranker on top of the fused top-K would likely still improve precision further — it's the natural next lever, deliberately not pulled yet.

Naming these unprompted, briefly, is worth more than being caught flat-footed by the follow-up question.

---

## How to actually run the conversation

**If they ask "tell me about a project":** give the 30-second pitch, then stop talking and let them pick a thread. Don't pre-emptively dump both chapters — that reads as reciting rather than reasoning.

**If they pull on the widget thread:** they're probably probing frontend/systems fundamentals — browser platform knowledge, not framework knowledge. Lead with the Shadow DOM decision, then volunteer the popup-portal bug yourself — a bug you found and explain beats a feature you're merely describing.

**If they pull on the RAG thread:** they're probing whether you actually understand retrieval or just wired up an SDK call. Lead with the hallucination failure mode, then hybrid search, then land on the `minSimilarity` floor — that's the single best "I understand *why*, not just *what*" line in the whole project.

**If they ask "how would you scale this":** Store interface → Postgres/pgvector, and be honest that brute-force works today because the corpus is small, not because it's clever.

**If they ask "what's the biggest security consideration":** two independent stories, not one — the backend as sole key-holder (Chapter Five), and the no-`eval` closed-node-type renderer for untrusted widget data (Chapter Four). Different threats, different fixes; naming both shows range.

**If they ask "what would you do differently":** go straight to the honest scars section above. Don't invent flaws that sound impressive but aren't true — the real gaps are more convincing than manufactured humility.

---

## Soundbites worth having ready

Short lines that tend to land, because they compress a whole design decision into one breath:

- *"The widget has to run correctly inside a page it doesn't control and didn't build."*
- *"Chunking is free, embedding costs money — so the cheap check runs first."*
- *"The floor's job isn't better ranking, it's making 'I don't know' possible."*
- *"RRF only cares about rank position, because cosine and BM25 scores were never comparable to begin with."*
- *"The whole backend exists because of one fact: an API key can't survive view-source."*
- *"There's no `eval` anywhere in the render path — that's the entire security model for untrusted widget data, on purpose."*

For the exhaustive, line-number-cited version of every answer referenced above, see [interview-prep.md](interview-prep.md) and the individual deep-dive docs it links to.
