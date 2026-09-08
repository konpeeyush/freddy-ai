import { useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp02Icon,
  Cancel01Icon,
  File01Icon,
  Globe02Icon,
  ImageAdd01Icon,
  Analytics01Icon,
  Layers01Icon,
  PlusSignIcon,
  PuzzleIcon,
  StopIcon,
} from "@hugeicons/core-free-icons"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

import { FREDDY_COLOR, FREDDY_INK } from "./freddy"
import { usePortalContainer } from "../lib/shadow"

/*
 * Composer: a bordered card holding the textarea, with its controls on a row
 * underneath — `+` on the left, send on the right.
 *
 * Typing `@` or `/` opens a menu above the card; ↑↓ + Enter to pick.
 *
 * Animations are CSS transitions rather than a motion library. The three
 * moving parts here (a rotating +, a send/stop swap, a popping menu) are cheap
 * in CSS, and `motion` measured at +39 KB gzipped — a third of this bundle, on
 * a script that loads on other people's pages.
 */

type Source = {
  key: string
  name: string
  desc: string
  icon: typeof Globe02Icon
  attach?: boolean
}

const SOURCES: Source[] = [
  {
    key: "orders",
    name: "Orders",
    desc: "Your recent purchases",
    icon: Analytics01Icon,
  },
  {
    key: "docs",
    name: "Help docs",
    desc: "Guides and troubleshooting",
    icon: Layers01Icon,
  },
  { key: "web", name: "Web search", desc: "Real-time info", icon: Globe02Icon },
]

const COMMANDS = [
  { key: "status", name: "/status", desc: "Check an order status" },
  { key: "refund", name: "/refund", desc: "Start a refund request" },
  { key: "track", name: "/track", desc: "Track a shipment" },
  { key: "human", name: "/human", desc: "Talk to a person" },
]

/** `+` actions. Distinct from the `@` sources: these *do* something. */
const ACTIONS: Source[] = [
  {
    key: "image",
    name: "Attach image",
    desc: "Add a screenshot or visual reference.",
    icon: ImageAdd01Icon,
    attach: true,
  },
  {
    key: "skill",
    name: "Use a skill",
    desc: "Give the agent a specialized workflow.",
    icon: PuzzleIcon,
  },
  {
    key: "context",
    name: "Add context",
    desc: "Include a file with supporting details.",
    icon: File01Icon,
    attach: true,
  },
]

const FILES = ["receipt.pdf", "screenshot.png", "order-export.csv"]

/** The last @word or /word being typed, if any. */
function parseToken(
  draft: string
): { kind: "at" | "slash"; query: string; start: number } | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft)
  if (!match) return null
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: (match[3] ?? "").toLowerCase(),
    start: match.index + (match[1]?.length ?? 0),
  }
}

export function Composer({
  onSend,
  onStop,
  loading = false,
  disabled,
  placeholder = "Ask us anything…",
  minRows = 1,
  maxRows = 6,
  className,
  onComposingChange,
}: {
  onSend: (text: string) => void
  onStop?: () => void
  loading?: boolean
  disabled?: boolean
  placeholder?: string
  minRows?: number
  maxRows?: number
  /** Lets the panel constrain the composer to a readable column. */
  className?: string
  /**
   * Fires when the visitor takes or leaves the prompt. The panel uses it to
   * put Freddy into his listening cycle — the composer owns the textarea, so
   * it is the only thing that knows.
   */
  onComposingChange?: (composing: boolean) => void
}) {
  const [draft, setDraft] = useState("")
  const [dismissed, setDismissed] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const plusRef = useRef<HTMLButtonElement>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [justSent, setJustSent] = useState(false)
  const [active, setActive] = useState(0)
  const [engaged, setEngaged] = useState(false)
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(
    null
  )

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  const portalContainer = usePortalContainer()

  const token = dismissed ? null : parseToken(draft)
  const menu: "at" | "slash" | null = token?.kind ?? null
  const query = token?.query ?? ""

  const rows: Source[] | typeof COMMANDS =
    menu === "at"
      ? SOURCES.filter((s) => s.name.toLowerCase().includes(query))
      : menu === "slash"
        ? COMMANDS.filter((c) => c.name.slice(1).startsWith(query))
        : []

  /*
   * Reset the selection when the menu or its filter changes. Derived during
   * render rather than in an effect — an effect here would cascade an extra
   * render on every keystroke.
   */
  const [selectionKey, setSelectionKey] = useState(`${menu}:${query}`)
  if (selectionKey !== `${menu}:${query}`) {
    setSelectionKey(`${menu}:${query}`)
    setActive(0)
    setEngaged(false)
  }

  /*
   * A single highlight glides to the active row rather than each row toggling
   * its own background — the movement is what makes keyboard nav readable.
   */
  useLayoutEffect(() => {
    const target = rowRefs.current[active]
    if (target)
      setRowBox({ top: target.offsetTop, height: target.offsetHeight })
  }, [menu, query, active, rows.length])

  /*
   * Size from a hidden mirror rather than the textarea's own scrollHeight —
   * scrollHeight has to be reset to 0 and re-read on every keystroke, which
   * forces two reflows. The trailing zero-width space keeps a final newline
   * measurable.
   */
  useLayoutEffect(() => {
    const textarea = inputRef.current
    const measure = measureRef.current
    if (!textarea || !measure) return
    const line = 24
    // The mirror carries no vertical padding, so add the textarea's own back
    // in — otherwise it sizes one padding-box short and the last line clips.
    const padding = 8
    const next = Math.min(
      Math.max(measure.scrollHeight, minRows * line),
      maxRows * line
    )
    textarea.style.height = `${next + padding}px`
  }, [draft, minRows, maxRows])

  /** An action from the `+` popover. Attaching ones add a chip. */
  function runAction(action: Source) {
    if (action.attach) {
      setAttachments((c) => [...c, FILES[c.length % FILES.length]!])
    }
    setPlusOpen(false)
    inputRef.current?.focus()
  }

  function pick(row: { key: string; name: string }) {
    const source = SOURCES.find((s) => s.key === row.key)
    if (source?.attach) {
      setAttachments((c) => [...c, FILES[c.length % FILES.length]!])
      if (token) setDraft(draft.slice(0, token.start))
    } else {
      const prefix = token ? draft.slice(0, token.start) : draft
      setDraft(
        menu === "at" ? `${prefix}@${row.name} ` : `${prefix}${row.name} `
      )
    }
    setPlusOpen(false)
    setDismissed(false)
    inputRef.current?.focus()
  }

  const canSend =
    (draft.trim().length > 0 || attachments.length > 0) && !disabled && !loading

  /* While a reply streams the same button is Stop, which is live whenever the
   * host gave us something to abort. */
  const sendDisabled = loading ? !onStop : !canSend

  /**
   * Whether a press landed on the `+` button, by coordinates.
   *
   * By coordinates because the event cannot say so itself. We mount into a
   * *closed* shadow root, and `composedPath()` on a listener outside one stops
   * at the host — so the document-level dismiss handler inside Base UI sees
   * every press in the widget as a press on our host element, the trigger
   * included. See `onOpenChange` below for what that breaks.
   */
  function pressedPlus(event: MouseEvent | PointerEvent | TouchEvent): boolean {
    const button = plusRef.current
    if (!button) return false
    const point = "changedTouches" in event ? event.changedTouches[0] : event
    if (!point) return false
    const box = button.getBoundingClientRect()
    return (
      point.clientX >= box.left &&
      point.clientX <= box.right &&
      point.clientY >= box.top &&
      point.clientY <= box.bottom
    )
  }

  function send() {
    if (!canSend) return
    onSend(draft.trim())
    setDraft("")
    setAttachments([])
    setPlusOpen(false)
    // A brief pulse so the click registers even when the reply is instant.
    setJustSent(true)
    window.setTimeout(() => setJustSent(false), 320)
  }

  return (
    <div ref={rootRef} className={cn("relative shrink-0 p-3", className)}>
      {/* ── @ / slash menu ─────────────────────────────── */}
      {menu ? (
        <div
          onMouseLeave={() => setEngaged(false)}
          className="absolute inset-x-3 bottom-full z-20 mb-2 overflow-hidden rounded-xl border bg-popover p-1.5 shadow-lg"
          style={{
            animation: "widget-pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
            transformOrigin: "bottom center",
          }}
        >
          {/* Single gliding highlight — appears once a row is hovered. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1.5 rounded-lg bg-muted"
            style={{
              top: rowBox?.top ?? 0,
              height: rowBox?.height ?? 0,
              opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
              transition:
                "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />
          {rows.map((row, i) => {
            const source =
              menu === "at" ? SOURCES.find((s) => s.key === row.key) : undefined
            return (
              <button
                key={row.key}
                type="button"
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  setActive(i)
                  setEngaged(true)
                }}
                onClick={() => pick(row)}
                className="relative z-10 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none"
              >
                {source ? (
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground">
                    <HugeiconsIcon icon={source.icon} className="size-4" />
                  </span>
                ) : null}
                <span className="min-w-0">
                  <span className="block text-sm">{row.name}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {row.desc}
                  </span>
                </span>
              </button>
            )
          })}
          {rows.length === 0 ? (
            <div className="px-2.5 py-2 text-sm text-muted-foreground">
              No matches for “{query}”
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── composer card ──────────────────────────────── */}
      <div
        className={cn(
          "relative w-full rounded-2xl border border-border/80 bg-background p-2 transition-colors focus-within:border-foreground/25",
          disabled && "opacity-60"
        )}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pt-0.5 pb-1.5">
            {attachments.map((file, i) => (
              <span
                key={`${file}-${i}`}
                className="flex h-6.5 items-center gap-1.5 rounded-lg bg-muted py-1 pr-1 pl-1.5 text-[11.5px] text-muted-foreground"
                style={{
                  animation:
                    "widget-pop-in 200ms cubic-bezier(0.23,1,0.32,1) both",
                }}
              >
                <HugeiconsIcon icon={File01Icon} className="size-3" />
                <span className="max-w-32 truncate">{file}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file}`}
                  onClick={() =>
                    setAttachments((c) => c.filter((_, j) => j !== i))
                  }
                  className="-my-1 flex size-5 items-center justify-center rounded transition-colors hover:bg-border hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {/* Hidden mirror the textarea is sized from. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-2 top-0 px-2 text-sm leading-6 [overflow-wrap:break-word] whitespace-pre-wrap"
        >
          {`${draft}\u200b`}
        </div>

        <textarea
          ref={inputRef}
          rows={minRows}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value)
            setDismissed(false)
            setPlusOpen(false)
          }}
          onKeyDown={(e) => {
            if (menu && rows.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault()
                setEngaged(true)
                setActive(
                  (c) =>
                    (c + (e.key === "ArrowDown" ? 1 : rows.length - 1)) %
                    rows.length
                )
                return
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault()
                pick(rows[active]!)
                return
              }
            }
            if (e.key === "Escape") {
              setDismissed(true)
              setPlusOpen(false)
              return
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              send()
            }
          }}
          onFocus={() => onComposingChange?.(true)}
          onBlur={() => onComposingChange?.(false)}
          placeholder={placeholder}
          aria-label="Prompt"
          className="block w-full resize-none overflow-y-auto bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground/55"
        />

        <div className="flex min-h-8 items-center gap-1">
          {/* + — a compact menu of actions, anchored to the button */}
          <DropdownMenu
            open={plusOpen}
            /*
             * Not `setPlusOpen` directly: the menu would not close when its
             * own trigger was pressed.
             *
             * Base UI classifies a press by walking `composedPath()` from a
             * document listener, and our shadow root is closed — so the path
             * stops at the host and a press on the trigger looks like a press
             * outside the menu. That fires a close, and then the trigger's own
             * toggle (running a beat later, on `mousedown`) saw a shut menu and
             * opened it again. The `+` rotated to a ✕ and nothing happened.
             *
             * Cancelling that one phantom close restores the invariant Base UI
             * is relying on — a press on the trigger is not an outside press —
             * and lets its toggle do the closing. Presses genuinely outside the
             * button still dismiss, since they miss the hit test.
             */
            onOpenChange={(next, details) => {
              if (
                !next &&
                details.reason === "outside-press" &&
                pressedPlus(details.event)
              ) {
                details.cancel()
                return
              }
              setPlusOpen(next)
            }}
          >
            <DropdownMenuTrigger
              ref={plusRef}
              type="button"
              aria-label="Add to prompt"
              disabled={disabled || loading}
              /*
               * The open state is styled as firmly as hover. Muted grey on the
               * composer's own surface is quiet enough to read as disabled
               * once the menu is up and the ✕ is the only way back out — the
               * one moment the button most needs to look pressable.
               */
              className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
            >
              <span
                aria-hidden="true"
                className="grid place-items-center transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{
                  transform: plusOpen ? "rotate(45deg)" : "rotate(0deg)",
                }}
              >
                <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              </span>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              // Portals default to document.body, which is outside the shadow
              // root — the menu would render unstyled.
              container={portalContainer}
              // Content sets its width from the trigger; the trigger here is a
              // 32px icon button, so override it.
              className="pointer-events-auto w-64 p-1.5"
            >
              {ACTIONS.map((action) => (
                <DropdownMenuItem
                  key={action.key}
                  onClick={() => runAction(action)}
                  className="items-start gap-2.5 rounded-lg px-2.5 py-2"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-muted-foreground">
                    <HugeiconsIcon icon={action.icon} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm">{action.name}</span>
                    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                      {action.desc}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* send — swaps to a stop square while a reply is streaming */}
          <button
            type="button"
            aria-label={loading ? "Stop generating" : "Send prompt"}
            disabled={sendDisabled}
            onClick={loading ? onStop : send}
            /*
             * Freddy's clay, not `--primary`.
             *
             * Send is the one control the visitor is being invited to press,
             * and on the neutral primary it read as another piece of chrome
             * next to the `+`. Carrying the assistant's own colour makes it
             * the one soft thing in the composer, and ties the button to the
             * face above it.
             *
             * Inline rather than a class because the palette is read from the
             * avatar definition — see `FREDDY_COLOR`. Dropped entirely while
             * disabled: an inline background would outrank `disabled:bg-muted`
             * and leave a dead button looking pressable.
             */
            style={
              sendDisabled
                ? undefined
                : { backgroundColor: FREDDY_COLOR, color: FREDDY_INK }
            }
            className={cn(
              "ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-[background-color,color,transform] duration-200 active:scale-95 disabled:bg-muted disabled:text-muted-foreground",
              justSent &&
                "animate-[widget-send-pulse_320ms_cubic-bezier(0.23,1,0.32,1)]"
            )}
          >
            {/* Both icons stay mounted so the swap can cross-fade. */}
            <span className="relative grid size-4 place-items-center">
              <span
                className="absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{
                  opacity: loading ? 0 : 1,
                  transform: loading
                    ? "translateY(-3px) scale(0.8)"
                    : "translateY(0) scale(1)",
                }}
              >
                <HugeiconsIcon icon={ArrowUp02Icon} className="size-4" />
              </span>
              <span
                className="absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{
                  opacity: loading ? 1 : 0,
                  transform: loading
                    ? "translateY(0) scale(1)"
                    : "translateY(3px) scale(0.8)",
                }}
              >
                <HugeiconsIcon
                  icon={StopIcon}
                  className="size-3 fill-current"
                />
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
