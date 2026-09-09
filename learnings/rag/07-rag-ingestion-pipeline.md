# RAG Ingestion Pipeline
_Website ko "padhna" aur usse ek searchable knowledge base banana_

## Yeh hai kya? (What is this)

Yeh woh pipeline hai jo ek company ka website crawl karke, uska text nikaal ke, chote-chote pieces mein todke, un pieces ko "vectors" (numbers ka array) mein convert karke, database mein store kar deta hai. Baad mein jab user chatbot se sawaal poochta hai, in stored pieces mein se sabse relevant wale nikaal ke AI model ko diye jaate hain — taaki model apni memory se guess na kare, balki asli website ke text se answer de.

Yeh sab `packages/rag/src/ingest.ts` ke `ingest()` function ke andar orchestrate hota hai — crawl → extract → chunk → embed → store, isi order mein.

## Yeh kyun banaya gaya? (Why it exists)

RAG (Retrieval-Augmented Generation) ka point yeh hai: LLM ko agar directly poocho "mera refund policy kya hai", woh confidently kuch bhi bana ke bol sakta hai — kyunki usne tumhara actual docs kabhi padha hi nahi. Solution: pehle se website/docs padh lo, chote pieces mein store kar do, aur sawaal aane pe sabse relevant pieces retrieve karke model ko context mein de do.

File ke top comment mein hi likha hai ki `ingest()` ek `async function*` (async generator) kyun hai, plain async function kyun nahi:

```ts
// packages/rag/src/ingest.ts:1-13
* An ingest takes minutes, and the playground's whole value is
* watching where it goes wrong — which pages were skipped, how many chunks a
* page produced, whether the crawler found a sitemap at all. A promise that
* resolves at the end can only report that it finished.
```

Matlab: ingest ek website ke liye minutes le sakta hai. Ek plain Promise sirf "finished" bata paata; developer ko dekhna hai kaunsa page skip hua kyun, aur kitne chunks bane — isliye har step pe ek **event yield** hota hai, real-time.

## Kaise kaam karta hai (How it works, step by step)

1. **Model safety check pehle** — Crawl shuru hone se pehle, `ingest()` check karta hai ki tenant ka existing index kis embedding model se bana tha (`store.indexModel`). Config ka model different hua toh turant `error` event yield karke ruk jaata hai (`ingest.ts:72-80`) — koi network request tak nahi jaati.

2. **Crawl** (`crawl.ts`) — Pehle sitemap dhoondta hai (`robots.txt` ya standard locations se). Mil gaya toh wahi trust karo, kyunki sitemap khud site batati hai "yeh mera page hai" — jabki link-crawl tag archives, pagination, print views bhi utha leti hai. Sitemap na mile tabhi fallback link-crawling hoti hai. `delayMs` (150ms) ka politeness gap aur `maxPages` (default 100) ka hard cap hai taaki bill na ude.

3. **Extract** (`extract.ts`) — Raw HTML se asli content nikalna. Ek docs page mostly 85% chrome (nav, sidebar, footer) hota hai — embed ho gaya toh har chunk ka vector usi chrome ki taraf drift karta hai aur search useless ho jaati hai. Mozilla's `Readability` (Firefox Reader Mode wala algorithm) + `linkedom` (lightweight in-Node DOM) + `turndown` (HTML → markdown) yeh saaf karte hain. FAQ Q/A pairs bhi yahin alag se nikaale jaate hain.

4. **Hash check — cheap skip** — Naye page ka content-hash purane stored hash se compare hota hai. Match hua toh "unchanged" maar ke skip — chunk/embed bilkul nahi hota. Yeh check chunking se *pehle* hai kyunki chunking free hai, embedding paisa lagti hai.

5. **Chunk** (`chunk.ts`) — Markdown headings ke basis pe todte hain (character-count pe nahi), kyunki heading ek natural boundary hai. Har chunk ke aage uska "heading path" prepend hota hai (jaise "Billing > Refunds") taaki chunk apne aap mein meaningful bane.

6. **Embed** (`embed.ts`) — Har chunk ka text ek 768-number vector mein convert hota hai, batches of 96 mein.

7. **Store** — `store.upsertPage()` page + uske chunks (embeddings ke saath) DB mein save karta hai.

8. **Optional prune** — `prune: true` diya ho toh crawl mein na dikhe pages DB se hata diye jaate hain. Default off.

9. **Done event** — Summary: pages, chunks, skipped/unchanged/removed, tokens, total time.

## Code walkthrough

- **`ingest.ts:72-80`** — Model-mismatch guard, crawl/embed se pehle:
  ```ts
  const model = embeddingModelId()
  const stored = await store.indexModel(options.tenantId)
  if (stored && stored !== model) {
    yield { kind: "error", message: `...built with ${stored}, but ${model} is configured now` }
    return
  }
  ```
  Dono models (Google, Ollama) same 768-dim vectors dete hain (`embed.ts:18`), toh mismatch crash nahi karega — chup-chaap galat results dega.

- **`ingest.ts:98-104`** — Hash comparison chunking se pehle: `if ((await store.pageHash(...)) === page.hash) { unchanged++; continue }`.

- **`crawl.ts:275-279`** — `crawl()` khud bhi async generator hai — page arrive hote hi extract/chunk/embed shuru, 100 pages ka HTML memory mein buffer nahi hota.

- **`extract.ts:59-78`** — `STRIP` list wo selectors hain jo Readability kabhi rakh leta hai (nav, `.sidebar`, `.cookie`) — forcibly remove hote hain.

- **`chunk.ts:230-236`** — `embeddable()` embed hone wala text banata hai (breadcrumb + text) — jo model ko diya jaata hai woh alag hai; breadcrumb sirf retrieval ke liye hai.

- **`backend/src/rag.ts:56-60`** — Ek tenant, ek ingest: `running.get(tenantId)?.abort()` phir naya controller set — naya start hote hi purana cancel.

## Diagram

Neeche diagram (`07-rag-ingestion-pipeline.excalidraw`) left-to-right pipeline dikhata hai: "Website URL" → "Crawl" (sitemap-aware) → "Extract" (Readability + turndown se clean markdown + FAQs) → ek decision diamond "Hash same as before?" jahan se "Yes" path upar se arc karke seedha "Done" tak jaata hai (chunk+embed skip, cheap!) aur "No" path "Chunk" → "Embed" → "Store" se hoke "Done" tak. Ek alag "Dashboard" box hai jisse ek dashed arrow "SSE progress events" label ke saath pipeline se wapas connect hoti hai — backend live events dashboard ko stream karta hai. Colors se stages alag dikhte hain: input orange, crawl/embed/store blue, extract/done purple, chunk/store green, decision yellow, dashboard pink. File excalidraw.com pe File → Open se uthao, ya canvas pe drag-drop kar do.

## Interview questions

**Q: RAG kya hai aur yeh kyun zaroori hai?**
A: Model ko answer se pehle relevant real documents "retrieve" karke context mein dena, taaki woh training memory se guess na kare. `ingest()` crawl karke content chunk/embed karta hai, `search()` query time pe relevant chunks nikaalta hai jo chat model ko diye jaate hain.

**Q: `ingest()` ek async generator kyun hai?**
A: Ingest minutes le sakta hai aur dashboard ko live progress dikhana hai. Async generator har step pe typed event (`start`/`page`/`skip`/`unchanged`/`done`/`error`) yield karta hai jo SSE ke through browser tak stream hota hai (`backend/src/rag.ts:67-98`).

**Q: Incremental re-ingest kaise kaam karta hai?**
A: Extract ke baad naye page ka SHA-256 hash purane `store.pageHash` se compare hota hai — match hua toh chunk/embed dono skip (`ingest.ts:98-104`). Chunking se pehle isliye hai kyunki chunking free hai, embedding paisa lagti hai.

**Q: Sitemap-first crawling kyun?**
A: Sitemap khud site ka statement hai "yeh meri real pages hain" — link-crawl tag archives, pagination bhi utha leta hai jo content nahi (`crawl.ts:4-7`). Sitemap na milne pe hi fallback crawling chalti hai.

**Q: Embedding-model mismatch guard kis problem ko rokta hai?**
A: Dono backends (Google, Ollama) 768-dim vectors dete hain (`embed.ts:18`), toh mismatch crash nahi karega — silently "confidently ranked garbage" results milne lagenge. `ingest.ts:72-80` yeh crawl/embed se pehle hi check karta hai aur `setIndexModel()` se model record karta hai.

**Q: "prune" option default off kyun hai?**
A: Pehli baar ka run ya `maxPages`-capped run poore site tak pahunch hi nahi paata — prune on hota toh un-reached pages ko "deleted" samajh liya jaata (`ingest.ts:41-44`). Isliye sirf scheduled refresh job mein explicitly on hota hai.

**Q: Do ingest requests aa jaayen ek tenant pe, tab kya hota hai?**
A: Dusra pehle wale ko reject nahi, `abort()` se cancel karta hai (`backend/src/rag.ts:56-60`) — "ingest phir dabana" almost hamesha matlab hota hai "URL badla", "dono chalao" nahi.

**Q: Page ka markdown empty/chota nikle toh?**
A: `extract()` typed failure return karta hai (`ok:false`, reason `"empty"`/`"too-short"`) instead of throwing ya khaali string store karne ke — dashboard pe developer ko dikhta hai *kyun* skip hua.

**Q: Heading-path prefix chunking mein itna important kyun?**
A: Isolated sentence jaise "You have 30 days from delivery" ambiguous hai. "Billing > Refunds >" prepend karne se embedding actual query ke paas lagta hai (`chunk.ts:10-15`) — comment khud kehta hai yeh recall model swap se zyada move karta hai.

## Common confusions (log yahan confuse hote hain)

- `ingest()` ko log "chal raha hai, wait karo" jaisa function samajh lete hain — jabki yeh event-stream hai jise `for await` se consume karte hain; backend SSE mein wrap karta hai, single JSON response nahi.
- "Unchanged" aur "skip" alag hain — unchanged matlab hash match (page badla nahi), skip matlab extract fail ya koi chunk hi nahi bana.
- Prune off-by-default ko log bug samajh lete hain jab purani pages delete nahi hoti — asal mein deliberate safety hai, partial crawl se data-loss rokne ke liye.
- Hash comparison chunking se *pehle* hoti hai, embedding se pehle nahi — subtle hai kyunki chunking bhi kaam hai, magar chunking free hai aur embedding paid.
