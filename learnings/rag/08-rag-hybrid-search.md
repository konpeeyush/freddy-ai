# RAG Hybrid Search — Vector + Keyword search, mixed together
_Do dost jo alag alag tareeke se sochte hain, milke ek behtar jawab dete hain — vector aur keyword search, dono._

## Yeh hai kya? (What is this)

Jab bhi widget se koi user kuch poochta hai, backend ko pehle relevant docs chunks dhoondhne padte hain jo answer banane mein kaam aayenge — isko "retrieval" kehte hain (RAG ka "R"). `packages/rag/src/search.ts` ka `search()` function yeh kaam karta hai, but ek hi tareeke se nahi — do alag retrieval methods (vector similarity aur keyword/BM25) chalata hai, aur unke results ko ek smart algorithm (Reciprocal Rank Fusion) se mix karke top 5 chunks deta hai. Isko "hybrid search" bolte hain kyunki dono approaches ke strengths combine ho jaate hain.

## Yeh kyun banaya gaya? (Why it exists)

Sirf vector search (meaning-based) use karne mein ek badi weakness hai — exact strings pe fail karta hai. File ke top comment mein hi likha hai:

```ts
// packages/rag/src/search.ts:4-8
 * Vector search alone loses on the queries support bots get most — exact
 * product names, error codes, API parameters, plan tiers. An embedding of
 * "SSO_REDIRECT_MISMATCH" is close to every other error string on the site,
 * while BM25 finds it instantly. Keyword search alone loses on the other half:
 * "can I get my money back" shares no words with a page titled "Refunds".
```

Matlab dono tareeke apni-apni jagah fail karte hain: sirf vector search se, error code jaisa random-ish token baaki sab error strings ke "numerically close" lagta hai — meaning-wise koi khaas signal nahi deta. Sirf keyword search se, "can I get my money back" jaisa natural sawaal "Refunds" page se literally zero words match karega. Isliye dono chalao, aur jo bhi mile use combine karo.

## Kaise kaam karta hai (How it works, step by step)

1. **Embedding model mismatch check pehle** — query embed karne se pehle hi check hota hai ki index jis model se bana tha, wahi model abhi configured hai (`search.ts:95-99`). Mismatch pe turant `EmbeddingModelMismatch` throw ho jaata hai — embed karne ka network call bhi waste nahi hota.
2. **Query embed hota hai** — `embedQuery(query)` query ko 768-number ka vector bana deta hai (`embed.ts`, next section mein detail).
3. **Vector search chalta hai** — `store.searchVector(tenantId, embedding, candidates)` cosine similarity se top 20 candidates dhoondta hai (`candidates: 20` default).
4. **Similarity floor apply hota hai** — `minSimilarity` (0.35) se kam score wala result discard ho jaata hai (`search.ts:108-110`) — reason agla section mein.
5. **Keyword search parallel mein chalta hai** — `store.searchKeyword` SQLite FTS5 (full-text search extension) se BM25 algorithm ke top 20 matches nikaalta hai.
6. **Dono lists RRF se fuse hoti hain** — `fuse(vector, keyword, limit)` har list ke har result ki sirf RANK POSITION dekhta hai, formula `1 / (60 + rank)` se score deta hai. Chunk dono lists mein aaya toh dono contributions add ho jaate hain.
7. **Top 5 return hote hain**, sorted by fused score, har ek pe `via: ["vector"]` / `["keyword"]` / `["vector","keyword"]` tag laga hota hai — batata hai result kis retriever se mila.

## Code walkthrough

- **`packages/rag/src/search.ts:37-41`** — defaults: `candidates: 20` (har retriever se kitne pull karte hain fusion se pehle), `limit: 5` (final results), `minSimilarity: 0.35` (vector floor).
```ts
export const DEFAULT_SEARCH: SearchOptions = {
  candidates: 20,
  limit: 5,
  minSimilarity: 0.35,
}
```

- **`packages/rag/src/search.ts:47-77`** — `fuse()` function, RRF ka actual implementation. Har list ko iterate karke `contribution = 1 / (RRF_K + rank + 1)` add karta hai; agar chunk pehle se map mein hai toh `via` array mein doosra retriever bhi push ho jaata hai:
```ts
const contribution = 1 / (RRF_K + rank + 1)
if (existing) {
  existing.score += contribution
  existing.via.push(via)
} else {
  fused.set(entry.chunk.id, { ...entry.chunk, score: contribution, via: [via] })
}
```

- **`packages/rag/src/search.ts:95-99`** — model mismatch check embedding se pehle. Comment khud reasoning deta hai: dono backends 768-float vectors hi output karte hain, toh mismatch crash nahi karega, balki "confidently ranked list of unrelated passages" dega — sabse kharab failure mode, kyunki koi error nahi dikhega.

- **`packages/rag/src/store/sqlite.ts:389-398`** — keyword search FTS5 ki apni query syntax se bachne ke liye raw query ko terms mein todta hai, quote karta hai, OR se jodta hai (apostrophe ya `*` FTS5 mein operator hai, syntax error de sakta hai):
```ts
const terms = query
  .toLowerCase()
  .split(/[^\p{L}\p{N}]+/u)
  .filter((t) => t.length > 2)
  .slice(0, 12)
  .map((t) => `"${t}"`)
```

- **`packages/rag/src/embed.ts:47-79`** — `backend()` function decide karta hai Google ya Ollama use karna hai (`resolveProvider()` se, jo chat model bhi use karta hai), aur `target` ("document" ya "query") ke hisaab se alag `taskType`/prefix deta hai — is wajah se document aur query embeddings symmetric nahi hote, jaan-boojh kar.

## Diagram

Neel diagram (`08-rag-hybrid-search.excalidraw`) mein dikhaya gaya hai ki ek "User query" do parallel paths mein split hota hai: ek taraf "Embed query" → "Vector search (cosine, floor 0.35)", doosri taraf directly "FTS5 keyword search (BM25)" — dono ek hi candidate pool pe kaam karte hain. Dono apni-apni "Ranked list" produce karte hain, jo ek "RRF Fuse (rank-based, k=60)" box mein milte hain, jahan se final "Top 5 results" box nikalta hai, neeche caption ke saath — "har result tagged: via vector / keyword / both". Excalidraw.com pe File → Open se kholo, ya file canvas pe drag-drop karo.

## Interview questions

**Q: Vector search akela use kyun nahi kar sakte?**
A: Exact strings pe weak hai — error codes/product names jaise tokens ka embedding meaningfully differentiate nahi hota, ek error code baaki sab error strings ke numerically close pad jaata hai. `search.ts` ke top comment mein `SSO_REDIRECT_MISMATCH` ka exactly yehi example hai — BM25 exact match se turant dhoondh leta hai jabki vector search confuse ho jaata hai.

**Q: Keyword search akela use kyun nahi kar sakte?**
A: Users apne words mein poochte hain, docs ke exact words mein nahi — "can I get my money back" ka koi word "Refunds" page se match nahi karega, so keyword-only zero results dega. Vector search meaning capture karta hai isliye yeh case handle kar leta hai.

**Q: RRF (Reciprocal Rank Fusion) kya hai aur weighted average kyun nahi use kiya?**
A: RRF sirf har result ki rank position dekhta hai, actual score nahi — formula `1 / (60 + rank)`. Weighted average nahi use kar sakte kyunki cosine similarity [-1, 1] range mein hai jabki BM25 unbounded aur corpus-dependent hai — numbers directly comparable nahi. Ek site pe jo weighting achhi kaam kare, doosri pe wrong ho sakti hai; rank position hi ek aisi property hai jo har corpus mein consistent transfer karti hai (`search.ts:10-14`). RRF_K=60 khud original paper ka value hai, bina per-corpus tuning ke achha kaam karta hai (`search.ts:43-45`).

**Q: `minSimilarity: 0.35` floor kyun rakha gaya hai — iska purpose ranking improve karna hai?**
A: Nahi, purpose ranking nahi, "I don't know" bolna possible banana hai. Vector search mein hamesha ek "closest" chunk milta hai chahe docs mein topic cover ho ya na ho — bina floor ke model ko kuch na kuch handed ho jaata hai aur woh confidently us se answer bana deta hai, jo hallucination ka sabse common mechanism hai (`search.ts:26-31`). Floor ensure karta hai ki 0.35 se kam similar chunk discard ho, taaki "no good match" genuinely reachable outcome bane.

**Q: Embedding-model mismatch check query embed hone SE PEHLE kyun hota hai?**
A: Do reasons — fail-fast (mismatch pata hai toh embed karne ka network round-trip hi waste hai), aur safety: dono backends 768-dimension vectors output karte hain, so check na ho toh mismatch silently ek "confidently ranked list of unrelated passages" dega — na crash, na empty result, bas galat answer jo model fact ki tarah cite karega (`search.ts:87-99`, `embed.ts:82-90`).

**Q: Agar `candidates: 20` ko `candidates: 5` kar do, kya problem aa sakta hai?**
A: Fusion ka pool chhota ho jaayega — koi chunk vector search mein rank 8 pe (top-5 se bahar) lekin keyword search mein rank 2 pe ho, toh candidates=5 se woh vector list mein include hi nahi hoga, sirf keyword se contribute karega. Dono retrievers se "second opinion" milne ka chance kam ho jaata hai, especially borderline-relevant chunks ke liye.

**Q: `via` field (vector/keyword/both tag) practically kis kaam aata hai?**
A: Debugging mein — result sirf `via: ["keyword"]` hai matlab embedding model query ko theek se samajh nahi paya, jabki `via: ["vector"]` batata hai wording unusual thi but keyword match nahi mila. `types.ts` ka comment hi kehta hai: "fastest way to tell 'the embedding is wrong' from 'the wording is unusual'" — yeh diagnostic signal hai, sirf metadata nahi.

## Common confusions (log yahan confuse hote hain)

- minSimilarity floor "better results" ke liye hai yeh sochna galat hai — purpose "no results" ko ek valid, reachable outcome banana hai.
- RRF scores ko cosine similarity ya BM25 score se directly compare kar sakte hain yeh sochna galat — fused score sirf apne result-set ke andar comparable hai (`Hit.score` comment, `types.ts`).
- Document aur query embeddings symmetric hote hain, yeh assume karna common mistake hai — jaan-boojh kar alag taskType/prefix use hote hain (`embed.ts:23-24, 57-65`), galti se same treat karo toh koi error nahi aayega, bas silently recall kharab ho jaayega.
- FTS5 ko "simple string match" samajhna galat hai — apni query syntax hai jisme apostrophe/`*`/`(` operators hain, isliye raw query direct nahi bhej sakte, terms split-quote-OR karne padte hain (`sqlite.ts:389-398`).
