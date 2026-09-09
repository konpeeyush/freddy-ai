# Backend + Vercel AI SDK
_LLM ko stream kaise karte hain, tools kaise chalte hain — bina API key chorai_

## Yeh hai kya? (What is this)

`packages/backend` ek Hono server hai jiska core route `POST /chat` hai. Yeh Vercel AI SDK ke `streamText()` se Gemini (ya local Ollama) ko call karta hai, reply ko token-by-token stream karta hai, aur beech mein model ko "tools" (functions) call karne deta hai — jaise apni knowledge base search karna. Widget in browser se seedha LLM ko kabhi nahi bulata, hamesha is backend ke through jaata hai.

## Yeh kyun banaya gaya? (Why it exists)

Widget ka bundle **customer ki website** par load hota hai — jo bhi us JS ke andar hai wo view-source/devtools se turant readable hai. Agar Gemini ka key widget mein daala, minutes mein chura liya jaayega. Backend ek trusted middle-man hai: sirf yeh key rakhta hai, widget sirf isse baat karta hai. Yeh reasoning code mein hi likha hai:

```ts
/*
 * Exists because the API key cannot ship in the widget — that bundle runs on
 * customers' pages, where anything in it is readable. The widget talks to
 * this; this talks to Gemini.
 */
```
`packages/backend/src/index.ts:61-63`

CORS `origin: "*"` bhi isi wajah se deliberately khula hai — widget kisi bhi customer domain par load ho sakta hai jo pehle se pata nahi, isliye per-origin allowlist fit nahi baithti (`packages/backend/src/index.ts:169-172`).

## Kaise kaam karta hai (How it works, step by step)

1. **Request `/chat` par aata hai**, Zod schema se validate hota hai — invalid toh 400, key missing toh 500 (`index.ts:432-450`).
2. **System prompt banta hai**: base `SYSTEM_PROMPT` + operator ki persona/restrictions + is turn ka `turnInstruction`, sab `.join("\n\n")` se additive — taaki operator kuch bhi likhe, citation/no-fabrication rules hamesha lagu rahe (`index.ts:456-471`).
3. **Model chuna jaata hai**: `chatModel()` (`model.ts`) provider ke hisaab se `google(id)` ya Ollama deta hai — Ollama fallback hai kyunki Google ke endpoints kuch networks par IP ke hisaab se `FAILED_PRECONDITION` de dete hain.
4. **`streamText()` call hota hai** — poora reply aane tak wait nahi karta, `result.stream` turant chunks deta hai.
5. **Tools do jagah se mix hote hain**: `resolveTools()` se server tools (abhi sirf `searchKnowledge`) aur `clientTools()` se page-defined tools — dono ek `tools` object mein spread ho jaate hain (`index.ts:499-507`).
6. **Model tool call kar sakta hai.** `searchKnowledge` yahin backend par `execute()` chalati hai (provider key + RAG store dono browser mein nahi rakh sakte). Client tool ka koi `execute` nahi hota — SDK usse "unfinished step" treat karta hai: call emit hoti hai, stream wahin **khatam** ho jaata hai, browser handler chalata hai aur result agle request mein wapas bhejta hai.
7. **`stopWhen: isStepCount(5)`** — iske bina model tool call ke turant baad ruk jaata; yeh model ko internal steps deta hai taaki `{ celsius: 31 }` "It's 31°C in Delhi." ban sake.
8. **`repairToolCall()`** ek cheap extra round-trip try karta hai jab call schema se mismatch ho — zyada zaroori yahan kyunki schemas customer likhta hai aur Gemini kuch JSON-Schema keywords silently drop kar deta hai apne dialect mein.
9. **`smoothStream()` + `Intl.Segmenter(word)`** tokens ko server-side pace karta hai — client-side space-splitting timer Chinese/Japanese/Thai (no-space scripts) mein poora reply ek frame mein dump kar deta, Segmenter har script ke real word boundaries jaanta hai.
10. **Do timeouts**: `firstChunkMs: 15_000` (model kuch bolta hi nahi) aur `totalMs: 120_000` (stream forever trickle kare) — alag failures catch karte hain, plus `maxRetries: 1`.
11. **Response `toUIMessageStream()`/`createUIMessageStreamResponse()`** se typed parts mein jaata hai (text-delta, tool-call, tool-result, error) — plain text nahi, kyunki tool call string mein represent hi nahi ho sakti.

## Code walkthrough

- **`index.ts:499-507`** — dono tool sources ek map mein merge:
  ```ts
  tools: {
    ...resolveTools(tenantId, parsed.data.tools),
    ...clientTools(parsed.data.clientTools),
  },
  ```
  Model ke liye dono "ek jaisi" tools dikhti hain; difference sirf `execute` ki presence/absence hai.
- **`tools/client.ts:33-53`** — client tool `type: "dynamic"` ke saath banti hai, `execute` deliberately missing — comment: "AI SDK treats a tool it cannot execute as a step it cannot finish."
- **`tools/index.ts:43-70`** — `searchKnowledge` per-request function se banti hai (`tenantId` closure mein bind), instance ke roop mein nahi — taaki ek tenant ka running ingest doosre ko override na kare, aur `tenantId` model ke `inputSchema` mein na ho (warna model "naming" karke dusre ka data maang sakta hai).
- **`repair.ts:32-66`** — `repairToolCall` ek separate `generateObject()` call se bad arguments fix karwata hai; naam hi galat (`NoSuchToolError`) toh null return — arguments rewrite karke naam ki galti fix nahi hoti.
- **`history.ts:53-135`** — `toModelMessages()` ek tool-call turn ko **3 messages** mein expand karta hai (assistant call → tool result → assistant reply), flatten nahi karta — resumed request mein call-without-result Gemini reject kar deta hai.
- **`packages/api/src/schema.ts:293-322`** — frontend ka `StreamEvent` raw SSE parts (`text-delta`, `tool-input-available`, `tool-output-available`) ko simple `kind`s mein narrow karta hai: `text`, `tool-start`, `tool-end`, `client-tool-call`, `widget`.

## Diagram

Neel diagram (`09-backend-chat-and-ai-sdk.excalidraw`) mein dikhaya gaya hai ki request kaise flow karti hai: "Widget (browser)" se `POST /chat` jaata hai "Hono server" par, jo `streamText()` ke through "Gemini / Ollama" ko call karta hai — response arrow "typed stream: text-delta / tool-call / tool-result / widget" label ke saath wapas widget ki taraf jaata hai. Do side-notes ("stopWhen" aur "repairToolCall") model box ke paas hain. Neeche ek "tools map" box do branches mein split hoti hai — "Server tool: searchKnowledge" (yahin execute hoti hai) aur "Client tool" (koi execute nahi, stream turant end). Client-tool box se red loop-back arrow ghoomkar wapas widget tak jaata hai, label "resumes on next request with the result".

## Interview questions

**Q: Widget "sirf JavaScript" hai — backend server ki zaroorat kyun padi?**
A: Kyunki widget ka bundle customer ki site par load hota hai jahan koi bhi view-source se sab padh sakta hai. Key widget mein hoti toh minutes mein churayi jaati. Backend hi real key hold karta hai, widget sirf usse baat karta hai (`index.ts:61-63`).

**Q: CORS `origin: "*"` security hole nahi hai kya?**
A: Deliberate hai — widget arbitrary customer domains par load hota hai jo deploy-time par pata nahi hote, ek allowlist fit nahi baithti. Real gate auth ke saath aana chahiye, jo iss iteration mein abhi nahi hai (`index.ts:169-172`).

**Q: `streamText()` vs `generateText()` — farq?**
A: `generateText()` poora response ready hone tak block karta; `streamText()` provider se chunks aate hi `result.stream` mein expose karta hai, isliye client ko token-by-token reply dikhta hai instead of blank spinner.

**Q: Server tool aur client tool ek hi `tools` map mein kyun hain?**
A: Model ke perspective se dono "callable tools" hi hain, farq pata nahi chalna chahiye. Real difference `execute` ki presence hai — server tool (`searchKnowledge`) ke paas hai, client tool (`type: "dynamic"`) ke paas nahi, isliye SDK usse incomplete step treat kar ke stream end kar deta hai.

**Q: `stopWhen: isStepCount(5)` hata do toh?**
A: Model tool call ke baad turant ruk jaayega — raw call + result milega, koi explaining sentence nahi banega.

**Q: `repairToolCall` kya solve karta hai, aur normal apps mein utna zaroori kyun nahi?**
A: Tool schemas customer ki page se aate hain aur Gemini convert karte waqt kuch JSON-Schema keywords drop kar deta hai — model looser contract follow kar raha hota hai. Repair ek sasta `generateObject()` call se galti + sahi schema dikha ke dubara puchta hai, poori turn fail nahi hoti.

**Q: Do timeouts alag kyun rakhe — ek hi kaafi nahi?**
A: Alag failure modes catch karte hain — `firstChunkMs: 15_000` model ke kuch na bolne ke liye, `totalMs: 120_000` forever-trickling stream ke liye. Ek single value dono ko sahi handle nahi kar payega.

**Q: Naya server tool banate waqt sabse common galti?**
A: `tenantId` ko tool ke `inputSchema` mein daal dena — model ise "choose" kar sakega, aur prompt-injection se dusre tenant ka data maang sakta hai. `searchKnowledge` jaisa pattern sahi hai: constructor `tenantId` leta hai, closure mein bind karta hai (`tools/index.ts:43-70`).

**Q: Client tool call bina result ke resumed request mein Gemini reject kyun nahi karta?**
A: `toModelMessages()` turn ko 3 messages mein expand karta hai (call → result → reply), flatten nahi karta. Dangling call (result-less) ka pair drop kar diya jaata hai, taaki provider reject na kare.

## Common confusions (log yahan confuse hote hain)

- "Client tool" ka matlab widget mein dummy implementation already hai — asal mein server par uska **koi** implementation hi nahi hota, execute browser mein hota hai.
- `smoothStream` client-side throttling nahi hai — server-side pacing hai, taaki har language (space-wali aur space-less dono) mein sahi kaam kare.
- `stopWhen` (steps ki limit) aur `toolChoice` (is turn tool call majboor hai ya nahi) alag cheezein hain, log confuse kar dete hain.
- Retrieval fail hone par server crash nahi karta — `searchKnowledge` `EmbeddingModelMismatch` ko catch kar ke model ko ek "note" text deta hai, taaki poori turn fail na ho.
