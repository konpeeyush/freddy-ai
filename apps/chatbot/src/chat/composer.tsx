import { useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp02Icon,
  Globe02Icon,
  Analytics01Icon,
  Layers01Icon,
  StopIcon,
} from "@hugeicons/core-free-icons"

import { cn } from "@workspace/ui/lib/utils"

import { FREDDY_COLOR, FREDDY_INK } from "./freddy"

/*
 * Composer: a bordered card holding the textarea, with send on the right of
 * the control row underneath.
 *
 * Typing `@` or `/` opens a menu above the card; ↑↓ + Enter to pick.
 *
 * Animations are CSS transitions rather than a motion library. The moving
 * parts here (a send/stop swap, a popping menu) are cheap in CSS, and
 * `motion` measured at +39 KB gzipped — a third of this bundle, on a script
 * that loads on other people's pages.
 */

type Source = {
  key: string
  name: string
  desc: string
  icon: typeof Globe02Icon
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

  function pick(row: { key: string; name: string }) {
    const prefix = token ? draft.slice(0, token.start) : draft
    setDraft(
      menu === "at" ? `${prefix}@${row.name} ` : `${prefix}${row.name} `
    )
    setDismissed(false)
    inputRef.current?.focus()
  }

  const canSend = draft.trim().length > 0 && !disabled && !loading

  /* While a reply streams the same button is Stop, which is live whenever the
   * host gave us something to abort. */
  const sendDisabled = loading ? !onStop : !canSend

  function send() {
    if (!canSend) return
    onSend(draft.trim())
    setDraft("")
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
                className="relative z-10 flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none"
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
             * and on the neutral primary it read as just another piece of
             * chrome. Carrying the assistant's own colour makes it the one
             * soft thing in the composer, and ties the button to the face
             * above it.
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
              "ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground transition-[background-color,color,transform] duration-200 active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
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
