# Chat State & Streaming
_What's going on inside the useChat hook — settled state in Query, the in-flight stream in plain React state_

## What is this?

`useChat` (`apps/chatbot/src/chat/use-chat.ts`) is the brain of the whole chat panel — messages, the streaming reply, tool calls, all of it comes from here. It has two separate "homes" for state: the **settled conversation** (already finished) in the TanStack Query cache, and the **in-flight stream** (still being typed out) in plain React `useState`. That split is the spine of this entire file.

## Why it exists

Two different problems, two different solutions:

The conversation has to survive the panel being closed and reopened, and pending/error state should be readable from one place — TanStack Query gives that for free, so the conversation lives in the Query cache under the `["conversation"]` key (`use-chat.ts:36-39`).

But Query is the wrong tool for streaming. Query notifies its subscribers in batches through `notifyManager`, on its own schedule, which doesn't line up with React's. The team actually tried writing every token straight into the cache:

```ts
// apps/chatbot/src/chat/use-chat.ts:304-312
 * TanStack Query batches subscriber notifications through its notifyManager,
 * so writing every chunk into the cache coalesced a 7-chunk reply into 2
 * paints — the stream was real but invisible. Query still owns the finished
 * conversation; only the token buffer is local.
```

So `streamingText`, `streamingWidgets`, and `streamingSources` are all plain `useState` — they re-render React immediately, per token, with no batching to wait on.

## How it works, step by step

1. **The user types and `send(text)` is called** → TanStack `useMutation`'s `.mutate()` (`use-chat.ts:745-752`). The mutation owns the whole turn; its `isPending` drives the "waiting" indicator.

2. The user's message is written into the Query cache immediately, and also persisted to the backend on a best-effort basis (fire-and-forget — a failure doesn't break the chat).

3. **The round loop starts**: `for (round = 0; round < roundsNeeded(MAX_TOOL_ROUNDS); round += 1)`. `MAX_TOOL_ROUNDS = 5` mirrors the server's step limit. Each round runs `streamChat()` — an async generator that yields SSE events.

4. **Every SSE event has its own `kind`**, and each kind touches different state:
   - `text` → appended to `received`, then `setStreamingText(received)` — the animated text with the cursor.
   - `tool-start`/`tool-end` → a server tool: set/clear `activeTool`, and merge sources from the output into `streamingSources`.
   - `client-tool-call` → a tool the BROWSER has to run itself. Not immediately — it's held in `outstanding` until the stream drains.
   - `widget` → a rich UI card. `closeTextPart()` first (the preceding text becomes its own part), the widget is pushed into `parts`, and `setStreamingWidgets` makes it appear right away.

5. At the end of a round, `outstanding.length === 0` means no client tool is pending — the turn ends here.

6. Otherwise every pending tool runs via `runTool()`. **A client tool pauses the whole turn** — the model emits the call, the stream ends, the browser runs the tool, the result is appended to `outbound`, and the next round starts. That's exactly why this is a "loop of rounds" rather than a single request.

7. **Sequences** (`tools/sequences.ts`) are checked here too — if a guided flow (a booking wizard) is running, `advance()` moves it to the next step, and `turnToolChoice()`/`turnInstruction()` force the model into a specific tool call on the next round.

8. **The turn settles** when the loop ends (naturally, or with the `awaitingVisitor` flag when the model has asked the visitor something). A `ChatMessage` is built and committed to the Query cache in a **single `write()` call** — which internally also runs `saveChat()`, so localStorage updates through the same funnel.

9. Cleanup happens on the same tick: streaming state is cleared so there's never a frame where the buffer is gone but the message hasn't rendered yet.

## Code walkthrough

- **`use-chat.ts:329-334`** — messages are read from the Query cache, and seeded from `loadChat()` if empty:
```ts
const messages =
  queryClient.getQueryData<ChatMessage[]>(conversationKey) ??
  (queryClient.setQueryData(conversationKey, () => {
    const stored = loadChat()
    return stored.length > 0 ? stored : initialMessages
  }) as ChatMessage[])
```

- **`use-chat.ts:351-360`** — `write()` is the single funnel *every* settled change passes through, which is why persistence hangs off it:
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

- **`use-chat.ts:679-680`** — a stream that closes without emitting a single token counts as a failed turn, not an empty answer: `if (!started) throw new Error("no response from the assistant")`

- **`use-chat.ts:233-245`** — `settledIds` is a module-scope `Set` (not component state), so the commit render and the cache notification can't race: they're scheduled differently, and when the cache write won the race the finished reply visibly "slid up".

- **`store.ts:89-96`** — `saveChat()` trims to `MAX_STORED_MESSAGES = 100` and, on a quota error, retries with progressively shorter tails (`[full, 20, 10, 4, 1]`) — localStorage is shared with the host page.

- **`store.ts:52-80`** — `loadChat()` re-validates every message with `ChatMessageSchema.safeParse`; an old message that doesn't match the new schema is silently dropped, without crashing the whole array.

## Diagram

The diagram (`03-chat-state-and-streaming.excalidraw`) shows how state flows from `send()` until the turn settles. From the top: a "User types → send()" box, then "Mutation starts, round=0", then a large "for each round: stream SSE events" loop box with four branches coming off it — text-delta (→ `setStreamingText`), tool-start/end (→ `activeTool` + `streamingSources`), client-tool-call (→ held in `outstanding`), and widget (→ `setStreamingWidgets`). Below it is a diamond, "outstanding client tools?" — yes goes to `runTool()`, with an arrow looping back to box C; no goes to "Turn settles → write() → Query cache + localStorage". Colors separate the two zones: blue/yellow/orange is plain React state (fast, per-token), and the green box is where the Query cache and localStorage update in one commit. Excalidraw.com → File → Open, or drag the file onto the canvas.

## Interview questions

**Q: Why are there two separate state containers in the chat panel — the Query cache and React state?**
A: Query is for the settled conversation, which has to survive the panel closing and reopening. The in-flight stream isn't in Query because its `notifyManager` batches notifications — writing every token into the cache coalesced a 7-chunk reply into just 2 paints (`use-chat.ts:304-312`). So the stream lives in plain `useState`, which re-renders immediately.

**Q: What is `MAX_TOOL_ROUNDS = 5` and why is it needed?**
A: It caps how many times a single turn can "bounce" between the model and the page's tools, mirroring the server's own step limit. Without a cap, a tool whose result nudges the model to call the same tool again could loop forever.

**Q: Why does a client tool call "pause" the turn instead of cancelling it?**
A: Only the browser can run a client tool. The stream ends, `runTool()` runs in the browser, and the result is appended to the next round's `outbound` messages — which avoids a dangling tool call, something the provider would reject on the next request.

**Q: Why are widgets and sources shown before the reply is complete?**
A: Retrieval finishes long before the closing sentence; holding the content back means showing a spinner over something that's already ready. `setStreamingWidgets`/`setStreamingSources` are called mid-stream (`use-chat.ts:97-110`).

**Q: Why isn't persistence (`saveChat`) done per token?**
A: `write()` is the single funnel every settled change passes through, and it's called once when the turn settles. Saving per token would mean far too many localStorage writes, and restoring a half-finished reply would be wrong anyway.

**Q: Why is `settledIds` a module-level `Set` rather than component state?**
A: Settling is two writes — the marker and the Query cache — with no shared schedule. When the cache write won the race, the finished reply visibly "slid up". A plain `Set` updates synchronously, so whichever render comes first already sees the updated marker (`use-chat.ts:217-232`).

**Q: Does the chat crash if `localStorage` quota is exceeded?**
A: No. `saveChat()` retries with progressively shorter tails — `[full, 20, 10, 4, 1]` messages. If nothing fits, it does a `removeItem` on its own key; the chat keeps working in memory, it just doesn't persist across a reload (`store.ts:108-126`).

**Q: Does `retry()` resend the whole conversation?**
A: No. It finds the last user message, trims the cache up to that message (dropping the partial reply), calls `mutation.reset()`, and then `mutation.mutate()` with the same text — the turn runs fresh (`use-chat.ts:774-782`).

**Q: To add a new event kind (say `"reasoning"`), where would the changes go?**
A: The `StreamEvent` union in `packages/api/src/schema.ts`, a new branch in `use-chat.ts`'s `for await` loop (with its own `useState`, not in the Query cache), and an expose in the `ChatState` type so `panel.tsx` can render it.

## Common confusions

- People assume streaming also lives in the Query cache — only *settled* messages are in Query; in-flight tokens are always in plain `useState`.
- `MAX_TOOL_ROUNDS` gets read as "max tool calls per turn" — they're actually rounds; multiple `outstanding` client tools can run together within one round.
- `saveChat()` is not "called on every message" — only once, when the turn settles, through `write()`.
- Seeing widgets/sources "stream" gets confused with the final reply render — these are two separate paths: `streamingWidgets`/`streamingText` for in-flight, and the message's `parts`/`sources` for settled (`panel.tsx`).
