import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  appendMessage,
  ChatAbortError,
  ChatRequestError,
  MAX_MESSAGE_SOURCES,
  streamChat,
  type ChatMessage,
  type MessagePart,
  type MessageSource,
  type StreamEvent,
  WidgetEnvelopeSchema,
} from "@workspace/api"

import { runTool, toolDefinitions } from "../tools/registry"
import {
  activeSequence,
  advance,
  cancelSequence,
  clearCompleted,
  isAskTool,
  roundsNeeded,
  turnInstruction,
  turnToolChoice,
} from "../tools/sequences"
import { clearChat, loadChat, saveChat } from "./store"
import { getConversationId, mintConversationId } from "./conversation-id"
import { getVisitorMeta } from "./visitor-meta"
import { useConversationPoll } from "./use-conversation-poll"

/*
 * Chat state.
 *
 * TanStack Query owns the *conversation* — it survives the panel closing and
 * reopening, and gives us one place to read pending/error from. It does not
 * own the *stream*: Query has no concept of a partial result, so the token
 * loop is hand-rolled and writes into the cache as chunks land.
 */

const conversationKey = ["conversation"] as const

/**
 * How many times a turn may bounce between the model and the page's tools.
 *
 * Mirrors the server's own step limit. A tool whose result prompts the model
 * to call it again would otherwise loop indefinitely, and each round is a
 * request the visitor is waiting on.
 */
const MAX_TOOL_ROUNDS = 5

/**
 * Messages a single request may carry.
 *
 * Below the server's own cap, and below it by enough that a turn mid-flow
 * cannot cross it: a request is the stored transcript plus one message per
 * tool round, and a six-step sequence is a dozen rounds. Sized equal to the
 * store's limit, the widget rejected its own requests part-way through a
 * flow — an "invalid request body" that named no field.
 */
const MAX_OUTBOUND_MESSAGES = 150

/**
 * Prose form of a reply that was all widget and no sentence.
 *
 * `text` is what goes back upstream on the next turn, so a widget-only reply
 * still has to say something — otherwise the model sees an empty assistant
 * turn and re-answers the same question.
 */
function summarise(parts: MessagePart[]): string {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.text
      if (part.kind === "widget") return part.summary ?? "[widget]"
      // Tool parts are the machinery of the turn, not its prose.
      return ""
    })
    .filter(Boolean)
    .join("\n\n")
}

/** A widget event as it arrives mid-stream, before the reply is committed. */
export type WidgetStreamPart = Extract<StreamEvent, { kind: "widget" }>

export type ChatState = {
  messages: ChatMessage[]
  /** Request sent, no tokens yet — this is what the typing dots watch. */
  isWaiting: boolean
  /** Tokens arriving. Stop is meaningful during both this and isWaiting. */
  isStreaming: boolean
  /** The reply currently arriving, before it is committed to the cache. */
  streamingText: string | null
  /**
   * Widgets that have landed in the in-flight reply.
   *
   * Shown before the turn commits: a widget often arrives well before the
   * model finishes its closing sentence, and holding it back would leave the
   * visitor watching a spinner over content that is ready.
   */
  streamingWidgets: WidgetStreamPart[]
  /**
   * What the in-flight reply has cited so far.
   *
   * Surfaced during the stream rather than at the end: retrieval finishes long
   * before the sentence built on it does, and showing the sources as soon as
   * they are known lets someone start reading where the answer came from while
   * it is still being written.
   */
  streamingSources: MessageSource[]
  /** Replies already on screen when they committed — they must not re-enter. */
  settledIds: Set<string>
  /** A tool the model is running right now, for the waiting indicator. */
  activeTool: string | null
  error: string | null
  send: (text: string) => void
  stop: () => void
  retry: () => void
  /**
   * Persists new data for one widget part.
   *
   * A booking confirming or a form submitting has to outlive the panel
   * closing, and widget state is derived from data — so the durable form of
   * "this is now booked" is the data itself, written back to the message.
   */
  /** Forgets the conversation, on screen and in storage. */
  reset: () => void
  updateWidget: (
    messageId: string,
    partIndex: number,
    data: unknown
  ) => void
}

/**
 * Pulls citable sources out of whatever a tool handed back.
 *
 * Shape-sniffed rather than keyed on the tool's name. Retrieval is a server
 * tool today, but a customer's page is free to define its own search over
 * their own corpus, and anything that answers with `passages` carrying a url
 * is citing something — there is no reason only ours should show sources.
 *
 * Returns an empty array for everything else, which is the overwhelmingly
 * common case: a weather lookup cites nothing.
 */
function sourcesFrom(output: unknown): MessageSource[] {
  if (!output || typeof output !== "object") return []
  const passages = (output as { passages?: unknown }).passages
  if (!Array.isArray(passages)) return []

  const out: MessageSource[] = []
  for (const entry of passages) {
    if (!entry || typeof entry !== "object") continue
    const { url, section, index } = entry as {
      url?: unknown
      section?: unknown
      index?: unknown
    }
    if (typeof url !== "string" || !url) continue
    /*
     * Must be absolute: the wire schema (MessageSourceSchema.url = z.url())
     * requires it, and a relative url from a customer's own tool would be
     * accepted here, saved to the message, then rejected by the server on the
     * next turn — stuck permanently, since the bad source is already
     * persisted. Dropping it here means the reply loses one citation rather
     * than the conversation losing its ability to continue.
     */
    try {
      new URL(url)
    } catch {
      continue
    }
    out.push({
      url,
      // Capped to match the schema for the same reason: an over-length title
      // would fail validation on reload and silently drop the whole message.
      title:
        typeof section === "string" && section
          ? section.slice(0, 300)
          : undefined,
      // The [n] the model was told to cite this passage as, when the tool
      // assigned one — a page-defined tool that only returns `passages`
      // shape without an index still shows in the list, just with nothing
      // in the reply text pointing back to it.
      index:
        typeof index === "number" && Number.isInteger(index) && index > 0
          ? index
          : undefined,
    })
  }
  return out
}

/**
 * Adds sources to a list, keeping the first mention of each url.
 *
 * Retrieval routinely returns several passages from one page — different
 * sections of the same document — and a citation row repeating one domain
 * five times tells the reader nothing. First wins because passages arrive
 * ranked, so the earliest is the best-matching section of that page.
 */
function mergeSources(
  current: MessageSource[],
  incoming: MessageSource[]
): MessageSource[] {
  const seen = new Set(current.map((source) => source.url))
  const merged = [...current]
  for (const source of incoming) {
    if (seen.has(source.url)) continue
    seen.add(source.url)
    merged.push(source)
    if (merged.length >= MAX_MESSAGE_SOURCES) break
  }
  return merged
}

/*
 * Replies that were already on screen when they committed.
 *
 * Module scope, not component state, and that is the whole point. Settling is
 * two writes — this marker and the query cache — and Query flushes its
 * subscribers through its own notifyManager, on a schedule React state updates
 * do not share. Whenever the cache notification won the race, the message
 * rendered before the marker had been applied and a finished reply visibly
 * slid up from below, having never moved while it was being written. A plain
 * Set is updated synchronously, so whichever render arrives first already sees
 * it. (A ref would do the same job but cannot be read during render.)
 *
 * Ids carry a timestamp and a counter, so two panels on one page cannot
 * meaningfully collide — and the cost if they somehow did is one skipped
 * animation, not a wrong message.
 */
const settledIds = new Set<string>()

/*
 * Unbounded, deliberately: an id is a short string, so even a conversation
 * with thousands of replies costs kilobytes, not a leak worth capping. A
 * cap that evicted the oldest id was tried and reverted — once a message
 * fell out, the next re-render saw `!settledIds.has(id)` flip back to true
 * and replayed that already-read message's entry animation, which is worse
 * than the unbounded growth it was avoiding.
 */
function markSettled(id: string): void {
  settledIds.add(id)
}

export function useChat({
  apiUrl,
  initialMessages = [],
  tools,
  tenantId,
}: {
  apiUrl: string
  initialMessages?: ChatMessage[]
  /**
   * Restricts the tools in the model's context. Only the playground sets it;
   * a real embed leaves it undefined and takes the server's defaults.
   */
  tools?: string[]
  /** Which knowledge base retrieval may read. Dev-only, like `tools`. */
  tenantId?: string
}): ChatState {
  const queryClient = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)
  const idRef = useRef(0)

  /*
   * The server-side conversation this transcript is persisted under.
   *
   * Independent of the transcript cache above: a stored conversation id
   * outlives `clearChat()` failing or storage being disabled, and a fresh
   * one is only minted on an explicit `reset()`, never just because
   * persistence itself failed for a turn.
   */
  const [conversationId, setConversationId] = useState(getConversationId)
  const baseUrl = useMemo(() => {
    try {
      return new URL(apiUrl).origin
    } catch {
      return null
    }
  }, [apiUrl])

  /*
   * Fire-and-forget: the live chat must work identically whether or not the
   * backend is reachable for persistence, so a failure here is swallowed
   * rather than surfaced as a chat error.
   */
  const persistMessage = useCallback(
    (message: ChatMessage, sender: "visitor" | "assistant") => {
      if (!baseUrl) return
      appendMessage(conversationId, {
        baseUrl,
        tenantId,
        message: { ...message, sender },
        ...(sender === "visitor" ? { visitorMeta: getVisitorMeta() } : {}),
      }).catch(() => {
        // See above — persistence is best-effort.
      })
    },
    [baseUrl, conversationId, tenantId]
  )

  const [isStreaming, setIsStreaming] = useState(false)
  /*
   * The in-flight reply lives in plain React state, not the query cache.
   *
   * TanStack Query batches subscriber notifications through its notifyManager,
   * so writing every chunk into the cache coalesced a 7-chunk reply into 2
   * paints — the stream was real but invisible. Query still owns the finished
   * conversation; only the token buffer is local.
   */
  const [streamingText, setStreamingText] = useState<string | null>(null)
  const [streamingWidgets, setStreamingWidgets] = useState<WidgetStreamPart[]>(
    []
  )
  const [streamingSources, setStreamingSources] = useState<MessageSource[]>([])

  const [activeTool, setActiveTool] = useState<string | null>(null)

  /*
   * Seeded once, from storage.
   *
   * A stored conversation wins over `initialMessages`: the latter is a
   * greeting or a seeded demo, and replacing a visitor's actual history with
   * it on every reload would be worse than showing nothing. An empty store
   * falls through to whatever the host passed.
   */
  const messages =
    queryClient.getQueryData<ChatMessage[]>(conversationKey) ??
    (queryClient.setQueryData(conversationKey, () => {
      const stored = loadChat()
      return stored.length > 0 ? stored : initialMessages
    }) as ChatMessage[])

  const nextId = useCallback(() => {
    idRef.current += 1
    return `m${Date.now()}-${idRef.current}`
  }, [])

  /*
   * The one funnel every settled change goes through, which is why persistence
   * hangs off it rather than off each call site — a turn committed anywhere
   * without saving would be a conversation that silently fails to survive a
   * reload.
   *
   * In-flight tokens do not come through here. They live in React state on
   * purpose, so a stream costs no writes and a half-finished reply is never
   * restored as though it were complete.
   */
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

  /* Operator replies sent from the dashboard land here, and are folded into
   * the same transcript the model's own replies render through. */
  const onOperatorMessages = useCallback(
    (incoming: ChatMessage[]) => {
      write((current) => {
        const seen = new Set(current.map((m) => m.id))
        const fresh = incoming.filter((m) => !seen.has(m.id))
        return fresh.length ? [...current, ...fresh] : current
      })
    },
    [write]
  )
  useConversationPoll({ apiUrl, conversationId, tenantId, onOperatorMessages })

  const mutation = useMutation({
    mutationKey: ["chat"],
    async mutationFn(text: string) {
      const controller = new AbortController()
      abortRef.current = controller

      const userMessage: ChatMessage = {
        id: nextId(),
        role: "user" as const,
        text,
      }
      const history = [
        ...(queryClient.getQueryData<ChatMessage[]>(conversationKey) ?? []),
        userMessage,
      ]
      write(() => history)
      persistMessage(userMessage, "visitor")

      const replyId = nextId()
      let started = false

      /*
       * Everything streamed so far.
       *
       * Rendered as it arrives: the server paces the deltas with
       * `smoothStream`, so a reply already types out at a readable rate
       * without a second timer here. Doing it server-side is also what makes
       * it work in scripts without spaces, which the old space-splitting
       * timer silently failed at.
       */
      let received = ""

      /*
       * Parts accumulate in arrival order so a reply can interleave prose and
       * widgets: "Here are three classes" → the carousel → "Let me know which
       * suits." Text is folded into the trailing text part as it streams, and
       * a widget closes that part off.
       */
      const parts: MessagePart[] = []
      /*
       * Accumulated across every round of the turn, because a model may search
       * more than once — narrowing after a first pass — and the reply is
       * grounded in all of it, not just the last call.
       */
      let sources: MessageSource[] = []

      /** Everything streamed since the last widget, awaiting a part of its own. */
      let textSinceWidget = ""

      const closeTextPart = () => {
        const text = textSinceWidget.trim()
        if (text) parts.push({ kind: "text", text })
        textSinceWidget = ""
      }

      /*
       * Tool calls the page has to answer before the turn can continue.
       * Collected during a round, drained after it.
       */
      let outstanding: Extract<StreamEvent, { kind: "client-tool-call" }>[]

      /*
       * The transcript sent upstream. It grows as page-defined tools are run:
       * each round appends the call and its result, and the next round sends
       * the lot so the model can see what its tool returned.
       */
      let outbound = history

      try {
        /*
         * One pass per round trip.
         *
         * A page-defined tool suspends the turn — the model emits the call,
         * the stream ends, and nothing more arrives until the result is sent
         * back up. Capped so a tool that keeps triggering itself cannot spin
         * forever; the cap matches the server's own step limit.
         */
        /*
         * A running sequence needs a round per remaining step. Read each
         * round rather than once up front: a flow can begin partway through
         * a turn, and the cap has to grow with it.
         */
        for (
          let round = 0;
          round < roundsNeeded(MAX_TOOL_ROUNDS);
          round += 1
        ) {
          outstanding = []

          for await (const event of streamChat({
            url: apiUrl,
            messages: outbound,
            signal: controller.signal,
            tools,
            clientTools: toolDefinitions(),
            /*
             * Both read per round, not once per turn: a flow can begin or end
             * part-way through a turn, and the constraint has to follow it.
             */
            toolChoice: turnToolChoice(),
            turnInstruction: turnInstruction(),
            tenantId,
          })) {
          if (event.kind === "tool-start") {
            // A lookup can take a second or two. Naming it beats silence.
            setActiveTool(event.tool)
            continue
          }
          if (event.kind === "tool-end") {
            setActiveTool(null)
            const cited = sourcesFrom(event.output)
            if (cited.length) {
              sources = mergeSources(sources, cited)
              setStreamingSources(sources)
            }
            continue
          }
          if (event.kind === "client-tool-call") {
            // Ours to run. Held until the stream drains, so the handler
            // cannot race the rest of the round.
            outstanding.push(event)
            continue
          }
          if (event.kind === "widget") {
            setActiveTool(null)
            // Any prose that preceded the widget becomes its own part, so the
            // widget lands after the sentence that introduced it.
            closeTextPart()
            parts.push({
              kind: "widget",
              widgetId: event.widgetId,
              version: event.version,
              data: event.data,
              summary: event.summary,
            })
            // A widget is content, so a reply that is *only* a widget has
            // still started — otherwise it would be treated as an empty turn.
            started = true
            setStreamingWidgets((current) => [...current, event])
            continue
          }

          if (!started) {
            // Flip out of "waiting" only once the first token lands, so the
            // indicator is not replaced by an empty bubble.
            started = true
            setIsStreaming(true)
          }
            received += event.delta
            textSinceWidget += event.delta
            setStreamingText(received)
          }

          // Nothing left for the page to answer: the turn is finished.
          if (outstanding.length === 0) break

          /*
           * Run what the model asked for, then send the transcript on with the
           * results attached. `runTool` always resolves — a handler that throws
           * or hangs still produces an error the model can relay, because a
           * call left unanswered would be a dangling tool call and the
           * provider rejects those on the next request.
           */
          const answered: MessagePart[] = []
          /*
           * Set when the model asked the visitor something and is waiting.
           *
           * The turn has to *end* there. Looping to another round would send
           * the transcript straight back with no reply in it, and the model —
           * still forced to call a tool — would ask again, or answer its own
           * question. The visitor needs the keyboard, not another round.
           */
          let awaitingVisitor = false

          for (const call of outstanding) {
            setActiveTool(call.tool)
            const { output, errorText } = await runTool(call.tool, call.input)

            /*
             * Move the flow on only once the handler has actually answered.
             * Advancing when the call was emitted would let a step that
             * failed count as done, and the flow would carry on past it.
             */
            if (!errorText) {
              const wasRunning = Boolean(activeSequence())
              advance(call.tool, (call.input ?? {}) as Record<string, unknown>)
              /*
               * A flow that just finished ends the turn.
               *
               * Its entry point is withheld from here on, but every ordinary
               * tool is back in context — and the model, reading a transcript
               * full of the topic it just worked through, reaches straight
               * for them again. The visitor saw the briefing repeat: the same
               * weather card, then "which city are you travelling to?".
               *
               * Stopping here lets the closing sentence be composed against a
               * finished flow rather than an open toolbox.
               */
              if (wasRunning && !activeSequence()) awaitingVisitor = true

              if (isAskTool(call.tool)) {
                awaitingVisitor = true
                /*
                 * The question carried by the call *is* the reply.
                 *
                 * The model was asked to narrate alongside this call and
                 * frequently did not, which left a turn with no text in it —
                 * read as a failed stream, and shown to the visitor as
                 * "something went wrong" over a question they never saw. So
                 * the argument is rendered directly, and only when the model
                 * has not already said something of its own.
                 */
                const question = (call.input as { question?: unknown } | null)
                  ?.question
                if (typeof question === "string" && question.trim()) {
                  if (!received.trim()) {
                    received = question.trim()
                    textSinceWidget = question.trim()
                    setStreamingText(received)
                  }
                  started = true
                }
              }
            }

            answered.push({
              kind: "tool-call",
              toolCallId: call.id,
              toolName: call.tool,
              input: call.input,
              // Carried back untouched — Gemini 3 rejects a replayed call
              // whose signature is missing.
              providerOptions: call.providerOptions,
            })
            answered.push({
              kind: "tool-result",
              toolCallId: call.id,
              toolName: call.tool,
              output,
              errorText,
            })

            // A page-defined search cites its results exactly as ours does.
            const cited = sourcesFrom(output)
            if (cited.length) {
              sources = mergeSources(sources, cited)
              setStreamingSources(sources)
            }

            /*
             * A handler may return a widget envelope, exactly as a server tool
             * does — so a page-defined tool can render a card rather than
             * narrate one.
             */
            const envelope = WidgetEnvelopeSchema.safeParse(output)
            if (envelope.success) {
              closeTextPart()
              const widgetPart = {
                kind: "widget" as const,
                widgetId: envelope.data.widgetId,
                version: envelope.data.version,
                data: envelope.data.data,
                summary: envelope.data.summary,
              }
              parts.push(widgetPart)
              started = true
              setStreamingWidgets((current) => [
                ...current,
                { ...widgetPart, id: call.id },
              ])
            }
          }
          setActiveTool(null)

          // Carry the call and its result into the next round.
          /*
           * Bounded as it grows.
           *
           * Each round appends a message, so a long sequence's turn can add a
           * dozen to an already-full transcript and push the request past
           * what the server accepts. Trimmed from the front, since a model
           * reads a conversation from the end — and the tool calls this turn
           * has already made are the part it cannot do without.
           */
          outbound = [
            ...outbound,
            {
              id: `${replyId}-t${round}`,
              role: "agent" as const,
              text: received,
              parts: answered,
            },
          ].slice(-MAX_OUTBOUND_MESSAGES)

          /*
           * Committed here rather than after the loop, because the reply is
           * finished: the question was streamed as prose alongside the call,
           * and the next thing to happen is the visitor typing.
           */
          if (awaitingVisitor) break
        }

        // A stream that closes without a single token is a failed turn, not an
        // empty answer — leaving a blank bubble would look like a UI bug.
        if (!started) throw new Error("no response from the assistant")

        closeTextPart()

        // Settled: hand the finished reply to the cache in one write. Flag it
        // first so the commit render already knows to skip the entry animation.
        markSettled(replyId)
        const reply: ChatMessage = {
          id: replyId,
          role: "agent",
          /*
           * `text` stays the prose form even for a widget-heavy reply: it is
           * what gets sent back upstream, and the model reasons in prose. A
           * widget contributes its summary, not its data.
           */
          text: received || summarise(parts),
          // Omitted when nothing was cited, so "never searched" stays
          // distinguishable from "searched and found nothing".
          ...(sources.length ? { sources } : {}),
          // Only when there is something a string cannot carry.
          parts: parts.some((p) => p.kind === "widget") ? parts : undefined,
        }
        write((c) => [...c, reply])
        persistMessage(reply, "assistant")
        // Same tick as the commit: clearing it in `finally` leaves one frame
        // where the buffer is gone but the message has not rendered, which
        // flashes the reply away and back.
        setStreamingText(null)
        setStreamingWidgets([])
        setStreamingSources([])
      } catch (cause) {
        // Keep whatever arrived before an abort — it is still a real reply.
        // Commit everything received, not just what had been revealed.
        if (cause instanceof ChatAbortError && (received || parts.length > 0)) {
          closeTextPart()
          markSettled(replyId)
          const reply: ChatMessage = {
            id: replyId,
            role: "agent",
            text: received || summarise(parts),
            ...(sources.length ? { sources } : {}),
            parts: parts.some((p) => p.kind === "widget") ? parts : undefined,
          }
          write((c) => [...c, reply])
          persistMessage(reply, "assistant")
          setStreamingText(null)
          setStreamingWidgets([])
          setStreamingSources([])
        }
        throw cause
      } finally {
        abortRef.current = null
        setStreamingText(null)
        setStreamingWidgets([])
        setStreamingSources([])
        setIsStreaming(false)
        setActiveTool(null)
      }
    },
    onError(error) {
      // Aborting is a user action, not a failure — keep whatever streamed.
      if (error instanceof ChatAbortError) mutation.reset()
    },
  })

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || mutation.isPending) return
      mutation.mutate(trimmed)
    },
    [mutation]
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const updateWidget = useCallback(
    (messageId: string, partIndex: number, data: unknown) => {
      write((current) =>
        current.map((message) => {
          if (message.id !== messageId || !message.parts) return message
          const parts = message.parts.map((part, index) =>
            index === partIndex && part.kind === "widget"
              ? { ...part, data }
              : part
          )
          return { ...message, parts }
        })
      )
    },
    [write]
  )

  /** Re-send the last user message, dropping whatever partial reply followed. */
  const retry = useCallback(() => {
    const current =
      queryClient.getQueryData<ChatMessage[]>(conversationKey) ?? []
    const lastUser = [...current].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    write((c) => c.slice(0, c.indexOf(lastUser)))
    mutation.reset()
    mutation.mutate(lastUser.text)
  }, [queryClient, write, mutation])

  const error =
    mutation.error && !(mutation.error instanceof ChatAbortError)
      ? mutation.error instanceof ChatRequestError
        ? mutation.error.message
        : "something went wrong"
      : null

  const reset = useCallback(() => {
    /*
     * A running sequence belongs to the conversation that started it.
     *
     * Left alone it would survive the reset, and the next conversation would
     * open mid-flow — the model holding a narrowed tool set, waiting on a
     * step the visitor has no idea it asked about.
     */
    cancelSequence()
    // A new conversation may run a flow the last one finished.
    clearCompleted()
    // Storage first: if the re-render raced the clear, the next write would
    // put the old transcript straight back.
    clearChat()
    queryClient.setQueryData<ChatMessage[]>(conversationKey, [])
    // A cleared transcript starting a new server-side conversation too —
    // continuing the old one would resurrect it the moment the visitor
    // sends a first message, defeating the point of "start over".
    setConversationId(mintConversationId())
  }, [queryClient])

  return {
    messages,
    isWaiting: mutation.isPending && !isStreaming,
    isStreaming,
    streamingText,
    streamingWidgets,
    streamingSources,
    settledIds,
    activeTool,
    error,
    send,
    stop,
    retry,
    reset,
    updateWidget,
  }
}
