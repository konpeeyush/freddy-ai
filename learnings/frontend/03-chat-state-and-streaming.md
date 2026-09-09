# Chat State & Streaming
_useChat hook ke andar kya chal raha hai — settled state Query mein, in-flight stream plain React state mein_

## Yeh hai kya? (What is this)

`useChat` (`apps/chatbot/src/chat/use-chat.ts`) poore chat panel ka dimaag hai — messages, streaming reply, tool calls, sab yahin se aata hai. Isme do alag "state ke ghar" hain: **settled conversation** (finish ho chuki) TanStack Query ke cache mein, aur **in-flight stream** (abhi type ho rahi) plain React `useState` mein. Yeh split hi is poore file ki spine hai.

## Yeh kyun banaya gaya? (Why it exists)

Do alag problems, do alag solutions:

Conversation ko panel close/reopen survive karni hai, aur ek jagah se pending/error read hona chahiye — TanStack Query yeh free mein deta hai, isliye conversation `["conversation"]` key ke neeche Query cache mein hai (`use-chat.ts:36-39`).

Lekin streaming ke liye Query galat tool hai. Query apne subscribers ko `notifyManager` se batch karke notify karta hai, apne hi schedule pe — jo React se match nahi karta. Team ne actual mein try kiya tha har token seedha cache mein likhna:

```ts
// apps/chatbot/src/chat/use-chat.ts:304-312
 * TanStack Query batches subscriber notifications through its notifyManager,
 * so writing every chunk into the cache coalesced a 7-chunk reply into 2
 * paints — the stream was real but invisible. Query still owns the finished
 * conversation; only the token buffer is local.
```

Isliye `streamingText`, `streamingWidgets`, `streamingSources` teeno plain `useState` hain — React ko turant re-render karwate hain, per token, batching ka wait nahi.

## Kaise kaam karta hai (How it works, step by step)

1. **User type karta hai, `send(text)` call hota hai** → TanStack `useMutation` ka `.mutate()` (`use-chat.ts:745-752`). Mutation poore turn ka owner hai; uska `isPending` "waiting" indicator drive karta hai.

2. User message turant Query cache mein likha jaata hai, aur best-effort backend ko persist bhi ho jaata hai (fire-and-forget — fail ho toh chat nahi todhta).

3. **Round loop shuru**: `for (round = 0; round < roundsNeeded(MAX_TOOL_ROUNDS); round += 1)`. `MAX_TOOL_ROUNDS = 5` server ke step limit mirror karta hai. Har round `streamChat()` — async generator jo SSE yield karta hai — chalata hai.

4. **Har SSE event ka apna `kind` hai**, har kind alag state chhoota hai:
   - `text` → `received` mein append, `setStreamingText(received)` — cursor-wali animated text.
   - `tool-start`/`tool-end` → server tool: `activeTool` set/clear, output se sources `streamingSources` mein merge.
   - `client-tool-call` → tool BROWSER ko khud chalana hai. Turant nahi, `outstanding` mein hold, jab tak stream drain na ho.
   - `widget` → rich UI card. `closeTextPart()` pehle (pichla text apna part ban jaata hai), widget `parts` mein push, `setStreamingWidgets` se turant dikh jaata hai.

5. Round ke end pe `outstanding.length === 0` matlab koi client tool pending nahi — turn yahin khatam.

6. Warna har pending tool `runTool()` se chalta hai. **Client tool poore turn ko pause kar deta hai** — model call emit, stream khatam, browser tool chalta hai, result `outbound` mein append, agla round shuru. Isi wajah se "loop of rounds" hai, single request nahi.

7. **Sequences** (`tools/sequences.ts`) bhi yahin check hoti hain — guided flow (booking wizard) chal raha ho toh `advance()` agle step pe le jaati hai, aur `turnToolChoice()`/`turnInstruction()` model ko agle round mein ek specific tool call pe force karte hain.

8. **Turn settle hota hai** loop khatam hone pe (naturally, ya `awaitingVisitor` flag ke saath jab model ne visitor se kuch poocha hai). Ek `ChatMessage` banta hai, **ek hi `write()` call** se Query cache mein commit — jo internally `saveChat()` bhi chalata hai, matlab localStorage bhi same funnel se update.

9. Cleanup same tick pe: streaming state clear ho jaata hai taaki koi frame aisa na ho jahan buffer gaya ho but message render na hua ho.

## Code walkthrough

- **`use-chat.ts:329-334`** — messages Query cache se read hote hain, khaali ho toh `loadChat()` se seed:
```ts
const messages =
  queryClient.getQueryData<ChatMessage[]>(conversationKey) ??
  (queryClient.setQueryData(conversationKey, () => {
    const stored = loadChat()
    return stored.length > 0 ? stored : initialMessages
  }) as ChatMessage[])
```

- **`use-chat.ts:351-360`** — `write()` woh ek funnel hai jisse *har* settled change guzarta hai, isliye persistence isi pe hang karti hai:
```ts
const write = useCallback(
  (update: (current: ChatMessage[]) => ChatMessage[]) => {
    queryClient.setQueryData<ChatMessage[]>(conversationKey, (current) => {
      const next = update(current ?? [])
      saveChat(next)
      return next
    })
  },
  [queryClient]
)
```

- **`use-chat.ts:679-680`** — ek bhi token diye bina stream close ho jaaye toh failed turn maana jaata hai, empty answer nahi: `if (!started) throw new Error("no response from the assistant")`

- **`use-chat.ts:233-245`** — `settledIds` module-scope `Set` hai (component state nahi), taaki commit render aur cache-notification ki race na ho: dono ka schedule alag hai, aur cache-write render pehle jeete toh finished reply "slide up" jaisi dikhti thi.

- **`store.ts:89-96`** — `saveChat()` `MAX_STORED_MESSAGES = 100` tak trim karta hai, quota error pe progressively shorter tail try karta hai (`[full, 20, 10, 4, 1]`) — localStorage host page ke saath shared hai.

- **`store.ts:52-80`** — `loadChat()` har message `ChatMessageSchema.safeParse` se re-validate karta hai; purana message naye schema se match na kare toh silently drop, poora array crash kiye bina.

## Diagram

Neel diagram (`03-chat-state-and-streaming.excalidraw`) mein dikhaya gaya hai ki `send()` se turn settle hone tak state kaise flow karti hai. Top se: "User types → send()" box, phir "Mutation starts, round=0" box, phir bada "for each round: stream SSE events" loop box jisse 4 branches nikalte hain — text-delta (→ `setStreamingText`), tool-start/end (→ `activeTool` + `streamingSources`), client-tool-call (→ held in `outstanding`), widget (→ `setStreamingWidgets`). Uske neeche diamond "outstanding client tools?" hai — haan toh `runTool()`, arrow loop wapas C box tak jaata hai; nahi toh "Turn settles → write() → Query cache + localStorage" box. Colours se do zones alag dikhte hain: blue/yellow/orange plain React state hai (fast, per-token), green box jahan Query cache aur localStorage ek commit mein update hote hain. Excalidraw.com → File → Open, ya file canvas pe drag karo.

## Interview questions

**Q: Chat panel mein do alag state containers kyun hain — Query cache aur React state?**
A: Query settled conversation ke liye hai, panel close/reopen survive karni hoti hai. In-flight stream Query mein nahi kyunki uska `notifyManager` notifications batch karta hai — har token cache mein likhne pe 7-chunk reply sirf 2 paints mein coalesce ho gayi thi (`use-chat.ts:304-312`). Isliye stream plain `useState` mein, jo turant re-render karta hai.

**Q: `MAX_TOOL_ROUNDS = 5` kya hai aur kyun zaroori hai?**
A: Model aur page ke tools ke beech ek turn mein kitni baar "bounce" ho sakta hai uski cap, server ke apne step limit ko mirror karti hai. Bina cap ke, ek tool jiska result model ko usi tool ko phir call karne pe uksaaye, infinite loop ban sakta hai.

**Q: Client tool call turn ko "pause" kyun karta hai, cancel kyun nahi?**
A: Client tool sirf browser hi chala sakta hai. Stream end hoti hai, `runTool()` browser mein chalta hai, result agle round ke `outbound` messages mein append hota hai — yeh dangling tool call se bachata hai, jise provider next request pe reject kar deta.

**Q: Widgets aur sources reply poora hone se pehle kyun dikhaye jaate hain?**
A: Retrieval closing sentence se bahut pehle finish ho jaata hai; content rok ke rakhna matlab ready cheez pe spinner dikhana. `setStreamingWidgets`/`setStreamingSources` stream ke beech hi call hote hain (`use-chat.ts:97-110`).

**Q: Persistence (`saveChat`) per-token kyun nahi hota?**
A: `write()` hi ek funnel hai jispe har settled change guzarta hai, aur turn settle hone pe ek baar call hota hai. Per-token save karne se bahut zyada localStorage writes hote, aur half-finished reply restore karna galat bhi hai.

**Q: `settledIds` module-level `Set` hai, component state nahi — kyun?**
A: Settling do writes hai — marker aur Query cache — jinka koi shared schedule nahi. Cache-write pehle jeet jaaye toh finished reply "slide up" jaisi dikhti thi. Plain `Set` synchronously update hoti hai, jo render pehle aaye already-updated marker dekhta hai (`use-chat.ts:217-232`).

**Q: `localStorage` quota exceed ho jaaye toh chat crash hoti hai kya?**
A: Nahi. `saveChat()` progressively shorter tails try karta hai — `[full, 20, 10, 4, 1]` messages. Kuch fit na ho toh apna key `removeItem` kar deta hai; chat memory mein kaam karti rehti hai, sirf reload pe persist nahi hoti (`store.ts:108-126`).

**Q: `retry()` poori conversation resend karta hai kya?**
A: Nahi. Last user message dhoondhta hai, cache ko us message tak trim kar deta hai (partial reply drop), `mutation.reset()` karta hai, phir usi text se `mutation.mutate()` karta hai — turn fresh chalta hai (`use-chat.ts:774-782`).

**Q: Naya event kind (jaise `"reasoning"`) add karna ho toh kahan change hoga?**
A: `StreamEvent` union mein `packages/api/src/schema.ts`, `use-chat.ts` ke `for await` loop mein naya branch (apna `useState`, Query cache mein nahi), aur `ChatState` type mein expose taaki `panel.tsx` render kar sake.

## Common confusions (log yahan confuse hote hain)

- Sochte hain streaming bhi Query cache mein hoti hai — sirf *settled* messages Query mein hain, in-flight tokens hamesha plain `useState` mein.
- `MAX_TOOL_ROUNDS` ko "max tool calls per turn" samajh lete hain — actually rounds hain; ek round mein multiple `outstanding` client tools ek saath chal sakte hain.
- `saveChat()` "har message pe call hoti hai" nahi — sirf turn settle hone pe, ek baar, `write()` ke through.
- Widget/source "streaming" dikhna final reply render se confuse karta hai — do alag paths hain: in-flight ke liye `streamingWidgets`/`streamingText`, settled ke liye message ke `parts`/`sources` (`panel.tsx`).
