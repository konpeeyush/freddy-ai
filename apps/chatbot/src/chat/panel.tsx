import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertCircleIcon,
  Cancel01Icon,
  MessageAdd01Icon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons"

import { Button } from "@workspace/ui/components/button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@workspace/ui/components/message-scroller"
import { MessageBubble } from "@workspace/ui/components/message-bubble"
import { ProgressiveBlur } from "@workspace/ui/components/progressive-blur"
import { cn } from "@workspace/ui/lib/utils"
import { WidgetPart, setWidgetChatSender } from "@workspace/widgets"

import { Composer } from "./composer"
import { Markdown } from "@workspace/ui/components/chat/markdown"
import { MessageActions } from "./message-actions"
import { WidgetSkeleton, type SkeletonShape } from "./widget-skeleton"
import { StreamingText } from "./streaming-text"
import type { SourcesHandle } from "@workspace/ui/components/chat/sources"
import { hasTool } from "../tools/registry"
import { Thinking } from "./thinking"
import { Freddy, type FreddyState, useFreddyState } from "./freddy"
import type { ChatMessage } from "./messages"
import { useChat, type WidgetStreamPart } from "./use-chat"
import { useWidgetConfig } from "../lib/widget-config"
import { useTheme } from "../lib/theme"

type ChatPanelProps = {
  /** Rendered only when the container can be dismissed (floating, fullscreen). */
  onClose?: () => void
  title?: string
  subtitle?: string
  /**
   * Centre the content on a readable column. Fullscreen sets this — at
   * viewport width, edge-to-edge text and a stretched composer both read
   * badly. Floating and inline are already narrow, so they leave it off.
   */
  centered?: boolean
}

/** Turns a tool name into something worth showing someone. */
const TOOL_LABELS: Record<string, string> = {
  getWeather: "Checking the weather",
  getCryptoPrice: "Checking prices",
  convertCurrency: "Converting",
  lookupArticle: "Reading",
  captureLead: "Loading form",
  findPlaces: "Finding places",
  findStays: "Finding stays",
}

function toolLabel(tool: string | null): string {
  if (!tool) return "Thinking"
  return TOOL_LABELS[tool] ?? "Working on it"
}

/**
 * Shapes the loading placeholder to match the widget the tool is expected to
 * render — a list of results shouldn't skeleton as one wide card. Keyed by
 * tool name because that's what's known before the tool has run; the widget
 * id itself isn't chosen until the handler calls `widget(...)`, so this is a
 * best guess for tools that always render the same widget, not a guarantee.
 */
const TOOL_SKELETONS: Record<string, SkeletonShape> = {
  getCryptoPrice: "list",
  findStays: "list",
  findPlaces: "carousel",
}

function toolSkeleton(tool: string | null): SkeletonShape {
  if (!tool) return "card"
  return TOOL_SKELETONS[tool] ?? "card"
}

/**
 * Whether a running tool should reserve space for something to be drawn.
 *
 * A page-defined tool almost always exists to put something on screen, so it
 * gets a placeholder the shape of the answer. A server tool does not: it
 * hands data to the model, which then writes prose. Reserving a card-shaped
 * frame for retrieval showed a picture-shaped hole where no picture was ever
 * coming, and then collapsed it — a flash of layout for nothing.
 *
 * Asked of the registry rather than hardcoded, so a customer adding a tool
 * gets the right behaviour without this file knowing the tool exists. The
 * registry is exactly the set of tools the page will execute, which is the
 * same question in different words.
 */
function toolDraws(tool: string | null): boolean {
  return Boolean(tool) && hasTool(tool as string)
}

/**
 * The scrolling message list.
 *
 * Split out from ChatPanel so it can call `useMessageScroller`, which only
 * works inside the Provider.
 */
function MessageList({
  messages,
  pending,
  streamingText,
  streamingWidgets,
  settledIds,
  error,
  onRetry,
  onWidgetChange,
  activeTool,
  centered,
  column,
  freddy,
}: {
  messages: ChatMessage[]
  pending: boolean
  /** The reply still arriving, if any — rendered as blur-in plain text. */
  streamingText: string | null
  /** Widgets already landed in the in-flight reply. */
  streamingWidgets: WidgetStreamPart[]
  /** Persists a widget's new data onto its message, so state survives reopen. */
  onWidgetChange: (
    messageId: string,
    partIndex: number,
    data: unknown
  ) => void
  /**
   * The message that just finished streaming. It is already on screen as the
   * streaming buffer, so re-animating it on commit would slide the whole
   * reply up again as if it were new.
   */
  settledIds: Set<string>
  error: string | null
  /** Re-runs the last turn; drives both the error row and the actions row. */
  onRetry: () => void
  /** Names the running tool in the waiting indicator, when one is running. */
  activeTool: string | null
  centered: boolean
  column: string | undefined
  /** Drives the empty state's face, so it reacts before the first message. */
  freddy: FreddyState
}) {
  const { scrollToEnd } = useMessageScroller()
  /*
   * One citation-list handle per message — `MessageActions` owns the list for
   * a committed reply — so a citation marker clicked in `Markdown`, a sibling
   * rather than a parent or child, can reach the right message's list. A ref
   * map rather than lifting `open` state up here: only those two ever need to
   * talk, and `ChatPanel` above has no reason to know a list is open.
   */
  const sourcesRefs = useRef(new Map<string, SourcesHandle>())
  const lastId = messages[messages.length - 1]?.id

  /*
   * `autoScroll` keeps the viewport pinned, but it lands instantly — which
   * reads as a jump-cut rather than as the list moving. Re-run it smoothly
   * whenever a message lands or the typing indicator appears.
   *
   * rAF because the new item has to be laid out before its height counts
   * toward the scroll target.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      scrollToEnd({ behavior: "smooth" })
    )
    return () => cancelAnimationFrame(frame)
  }, [lastId, pending, streamingText, streamingWidgets.length, error, scrollToEnd])

  return (
    <MessageScroller className="flex-1">
      <MessageScrollerViewport>
        <MessageScrollerContent
          className={cn(
            "flex flex-col gap-5 p-4",
            // Clear the floating header, which no longer takes up space.
            centered ? "pt-28" : "pt-20",
            column
          )}
        >
          {messages.length === 0 && !pending && !error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
              <Freddy state={freddy} size={96} ariaLabel="Freddy" />
              <div>
                {/* First person, and a name: the face above it is Freddy's,
                    and "we" reads as a company where the panel is one
                    assistant. */}
                <p className="text-sm font-medium">Hi, I&apos;m Freddy</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ask me anything to get started.
                </p>
              </div>
            </div>
          ) : null}
          {messages.map((m) =>
            m.role === "user" ? (
              // User: a bubble, aligned to the end.
              <MessageScrollerItem
                key={m.id}
                messageId={m.id}
                className="flex animate-[widget-message-in_320ms_cubic-bezier(0.23,1,0.32,1)_both] justify-end ps-8 pe-3.5"
              >
                <MessageBubble
                  variant="sent"
                  message={m.text}
                  className="text-sm"
                />
              </MessageScrollerItem>
            ) : (
              // Agent: plain markdown, no bubble, full width.
              <MessageScrollerItem
                key={m.id}
                messageId={m.id}
                className={cn(
                  "min-w-0",
                  // Already on screen as streaming text — replaying the
                  // entry animation would slide a finished reply up from
                  // below, having never moved while it was being written.
                  !settledIds.has(m.id) &&
                    "animate-[widget-message-in_320ms_cubic-bezier(0.23,1,0.32,1)_both]"
                )}
              >
                {/*
                  A reply with widgets renders as ordered parts; one without
                  keeps the plain-markdown path, so nothing changes for the
                  overwhelming majority of messages.
                */}
                {m.parts?.length ? (
                  <div className="flex min-w-0 flex-col gap-3">
                    {m.parts.map((part, index) => {
                      if (part.kind === "text") {
                        return (
                          <Markdown
                            key={index}
                            content={part.text}
                            sources={m.sources}
                            idPrefix={`citation-${m.id}`}
                            onCitationClick={(id) =>
                              sourcesRefs.current.get(m.id)?.openAndScrollTo(id)
                            }
                          />
                        )
                      }
                      if (part.kind === "widget") {
                        return (
                          <WidgetPart
                            key={index}
                            payload={part}
                            onDataChange={(data) =>
                              onWidgetChange(m.id, index, data)
                            }
                          />
                        )
                      }
                      /*
                       * Tool calls and their results are how the turn was
                       * produced, not part of it. They ride in `parts` so the
                       * model can see them on the next request; the visitor
                       * sees whatever the tool rendered or the model said.
                       */
                      return null
                    })}
                  </div>
                ) : (
                  <Markdown
                    content={m.text}
                    sources={m.sources}
                    idPrefix={`citation-${m.id}`}
                    onCitationClick={(id) =>
                      sourcesRefs.current.get(m.id)?.openAndScrollTo(id)
                    }
                  />
                )}
                {/* The reply's sources trigger rides in this same row — see
                    MessageActions — rather than on a line of its own. */}
                <MessageActions
                  ref={(handle) => {
                    if (handle) sourcesRefs.current.set(m.id, handle)
                    else sourcesRefs.current.delete(m.id)
                  }}
                  sources={m.sources}
                  idPrefix={`citation-${m.id}`}
                />
              </MessageScrollerItem>
            )
          )}
          {/*
            Widgets from the in-flight reply, shown before it commits. A
            widget usually lands well before the model's closing sentence, and
            holding it back would mean a spinner over content that is ready.
          */}
          {streamingWidgets.map((widget) => (
            <MessageScrollerItem
              key={widget.id}
              messageId={widget.id}
              className="min-w-0 animate-[widget-message-in_320ms_cubic-bezier(0.23,1,0.32,1)_both]"
            >
              <WidgetPart payload={widget} />
            </MessageScrollerItem>
          ))}
          {streamingText !== null ? (
            <MessageScrollerItem messageId="streaming" className="min-w-0">
              {/*
                Text only. Retrieval resolves long before the sentence built on
                it does, so the sources row *could* appear mid-stream — but it
                anchors to the bottom of a block that is still growing, which
                walks it down the panel line by line and puts a control under
                the reader's cursor that moves as they read. It lands once,
                with the committed message, from `MessageActions`.
              */}
              <StreamingText text={streamingText} />
            </MessageScrollerItem>
          ) : null}
          {pending ? (
            <MessageScrollerItem
              messageId="typing"
              className="min-w-0 animate-[widget-message-in_240ms_cubic-bezier(0.23,1,0.32,1)_both]"
            >
              {/*
                A tool that draws gets the quiet chevron, because a skeleton
                the shape of its answer is already sitting underneath it. One
                that only returns data gets the dot-matrix mark — it is the
                only thing on screen for that wait.
              */}
              <Thinking
                label={toolLabel(activeTool)}
                /*
                 * The mark says what kind of work is happening, not which tool
                 * is doing it: the matrix means "off consulting something",
                 * the chevron means "the model is thinking". Keyed on whether
                 * a tool is running at all, so the two are told apart by the
                 * same rule every time — the earlier split, on whether the
                 * tool drew a widget, put two different marks on what a
                 * visitor reads as one state.
                 */
                loader={activeTool ? "matrix" : "chevron"}
              />
            </MessageScrollerItem>
          ) : null}
          {/*
            A tool that will draw something gets a placeholder the shape of the
            answer, rather than a line of text followed by a card appearing all
            at once. Only tools that actually draw — see `toolDraws`: a
            retrieval tool feeds the model prose, and framing a card for it
            shows a picture-shaped hole where no picture is coming.
          */}
          {pending && toolDraws(activeTool) ? (
            <MessageScrollerItem
              messageId="widget-placeholder"
              className="min-w-0 animate-[widget-message-in_240ms_cubic-bezier(0.23,1,0.32,1)_both]"
            >
              <WidgetSkeleton
                label={`${toolLabel(activeTool)}…`}
                shape={toolSkeleton(activeTool)}
              />
            </MessageScrollerItem>
          ) : null}
          {error ? (
            <MessageScrollerItem
              messageId="error"
              className="min-w-0 animate-[widget-message-in_240ms_cubic-bezier(0.23,1,0.32,1)_both]"
            >
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <HugeiconsIcon
                  icon={AlertCircleIcon}
                  className="mt-0.5 size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 cursor-pointer font-medium underline underline-offset-2 hover:no-underline"
                >
                  Retry
                </button>
              </div>
            </MessageScrollerItem>
          ) : null}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      {/* Absolutely positioned against Root, so it sits outside Viewport. */}
      <MessageScrollerButton />
    </MessageScroller>
  )
}

/**
 * The chat UI itself.
 *
 * Deliberately container-agnostic: no `fixed`, no viewport units, no z-index.
 * It fills whatever box its parent gives it, which is what lets the same
 * component serve the floating frame, the inline aside and fullscreen.
 */
export function ChatPanel({
  onClose,
  title = "Freddy",
  subtitle,
  centered = false,
}: ChatPanelProps) {
  // Applied to the header row, the message list and the composer alike, so
  // all three line up on the same column.
  const column = centered ? "mx-auto w-full max-w-3xl" : undefined
  const { apiUrl, tools, tenantId } = useWidgetConfig()
  const {
    messages,
    isWaiting,
    isStreaming,
    streamingText,
    streamingWidgets,
    settledIds,
    activeTool,
    error,
    send,
    stop,
    retry,
    reset,
    updateWidget,
  } = useChat({ apiUrl, tools, tenantId })
  const { theme, toggle } = useTheme()

  /*
   * Freddy's state, derived rather than stored: the chat already knows whether
   * an answer is in flight, and the composer reports whether the visitor is at
   * the keyboard. The only thing the hook adds is the beat of pleasure after a
   * reply lands, which nothing else in the panel has a name for.
   */
  const [composing, setComposing] = useState(false)
  const freddyState = useFreddyState({
    waiting: isWaiting,
    streaming: isStreaming,
    activeTool,
    listening: composing,
    error: Boolean(error),
  })

  /*
   * Starting a new chat throws the transcript away, so it asks first.
   *
   * A second press rather than a dialog: a modal over a 440px panel covers
   * the thing it is asking about, and this is recoverable enough not to earn
   * that. The button says what the next press will do and reverts on its own,
   * so an accidental press costs a moment rather than the conversation.
   */
  const [confirmingReset, setConfirmingReset] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    []
  )

  const handleReset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)

    if (!confirmingReset) {
      setConfirmingReset(true)
      resetTimer.current = setTimeout(() => setConfirmingReset(false), 3000)
      return
    }

    setConfirmingReset(false)
    reset()
  }

  // Nothing to discard, so nothing to confirm — and no button either.
  const canReset = messages.length > 0

  /*
   * The widget action fallback.
   *
   * With no host-page listener registered, a widget button click becomes a
   * visitor message and the AI drives the rest of the flow. That is what lets
   * someone ship a booking widget without their developer writing any
   * JavaScript, so it is wired by default rather than opted into.
   */
  useEffect(() => {
    setWidgetChatSender(send)
    return () => setWidgetChatSender(null)
  }, [send])

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      {/*
       * Floats over the messages in every layout: a hard rule under the header
       * cuts the panel in two, where a blur ramp keeps it one surface and still
       * separates the title from whatever scrolls beneath it.
       */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 shrink-0">
        <ProgressiveBlur
          position="top"
          height={centered ? "7rem" : "5rem"}
          className="-z-10"
          // Gentler than the default ramp: this sits behind text, so the
          // strongest layer only needs to soften what passes under the
          // title, not obliterate it.
          blurLevels={[0.5, 1, 2, 3, 5, 8]}
        />
        {/* Blur alone still lets colour through; this wash is what keeps
            the header legible over whatever scrolls past. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 -z-10",
            centered ? "h-28" : "h-20"
          )}
          style={{
            background:
              "linear-gradient(to bottom, var(--background) 0%, color-mix(in oklab, var(--background) 92%, transparent) 55%, transparent 100%)",
          }}
        />
        <div
          className={cn(
            "pointer-events-auto relative flex items-center gap-3 px-4",
            centered ? "py-4" : "py-3",
            column
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center">
            <Freddy state={freddyState} size="100%" ariaLabel={title} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            {subtitle ? (
              <p className="truncate text-xs text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
          {canReset ? (
            <Button
              variant="ghost"
              size={confirmingReset ? "sm" : "icon-sm"}
              onClick={handleReset}
              /*
               * Blurring cancels the pending confirmation: a button left
               * armed is one a later, unrelated click can trip.
               */
              onBlur={() => setConfirmingReset(false)}
              aria-label={
                confirmingReset
                  ? "Confirm — discard this conversation and start a new one"
                  : "Start a new chat"
              }
            >
              {confirmingReset ? (
                <span className="text-xs">Start over?</span>
              ) : (
                <HugeiconsIcon icon={MessageAdd01Icon} className="size-4" />
              )}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            <HugeiconsIcon
              icon={theme === "dark" ? Sun03Icon : Moon02Icon}
              className="size-4"
            />
          </Button>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close chat"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      {/* Provider supplies the scroller context; Root alone does not. */}
      <MessageScrollerProvider autoScroll>
        <MessageList
          messages={messages}
          pending={isWaiting}
          streamingText={streamingText}
          streamingWidgets={streamingWidgets}
          settledIds={settledIds}
          error={error}
          onRetry={retry}
          onWidgetChange={updateWidget}
          activeTool={activeTool}
          centered={centered}
          column={column}
          freddy={freddyState}
        />
      </MessageScrollerProvider>

      <Composer
        onSend={send}
        loading={isWaiting || isStreaming}
        onStop={stop}
        onComposingChange={setComposing}
        className={column}
      />
    </div>
  )
}
