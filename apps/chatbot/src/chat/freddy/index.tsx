import { HugeiconsIcon } from "@hugeicons/react"
import { ChatBotIcon } from "@hugeicons/core-free-icons"
import { AvatarCanvas } from "@claykit/react"
import { validateAvatarDefinition, type AvatarDefinition } from "@claykit/core"
import { useEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

import rawDefinition from "./freddy.avatar.json"

/*
 * Freddy — the assistant's face.
 *
 * A procedural SVG avatar rather than a static icon, because the one glyph in
 * the header is the only part of the panel that is always on screen: it is the
 * cheapest place to say "I heard you" or "I'm working" without adding another
 * spinner.
 *
 * Rendered through `@claykit/react`'s `<AvatarCanvas>`, which owns the whole
 * pipeline — playback, geometry, and the "clay" finish (gradient, bevel,
 * grain, contact shadow) — so this file only owns what's specific to *this*
 * bot: the palette re-exports, and the mapping from the chat's own state
 * (waiting/streaming/listening/error) to the definition's animation and
 * expression names.
 *
 * One file, one JSON: everything Freddy-specific lives here rather than
 * split across several small modules, since this whole file is the unit that
 * gets copied when the next bot gets a face.
 */

/**
 * Validates the definition once at module scope rather than throwing: this
 * bundle runs on other people's pages, where a definition the runtime
 * rejects must cost us a face, not the chat. The fallback is the icon Freddy
 * replaced.
 */
function parseDefinition(source: unknown): AvatarDefinition | null {
  const result = validateAvatarDefinition(source)
  if (result.ok) return result.value
  const first = result.errors[0]
  console.error(
    `[freddy] avatar definition rejected${first?.path ? ` at ${first.path}` : ""}: ${first?.message ?? "unknown error"}`
  )
  return null
}

const definition = parseDefinition(rawDefinition)

/** Freddy's palette, read from the definition rather than copied into a token. */
export const FREDDY_COLOR = rawDefinition.colors.body

/**
 * What to draw *on* Freddy's clay. Taken from the definition's own eye
 * colour — a near-white that clears icon contrast comfortably against the
 * warm terracotta body.
 */
export const FREDDY_INK = rawDefinition.colors.eyes

/**
 * What Freddy is doing, in the panel's terms rather than the avatar's.
 *
 * The bot drifts off when nobody's talking to it and wakes with a start when
 * they come back — `drowsy`/`sleeping` and `waking` carry that. `thinking`
 * and `searching` split "processing" by what's actually happening: chasing a
 * tool call reads as pondering, a reply typing itself out reads as working.
 */
export type FreddyState =
  | "idle"
  | "listening"
  | "drowsy"
  | "sleeping"
  | "waking"
  | "thinking"
  | "searching"
  | "pleased"
  | "error"

type Animation = keyof typeof rawDefinition.animations
type Expression = keyof typeof rawDefinition.expressions

/*
 * The definition's `animationOrder` is narrower than `FreddyState` — it has
 * no dedicated "drowsy" or "searching" timelines. `drowsy` holds a static
 * expression instead (still blinks — ambient motion runs under a held
 * expression too), and `searching` borrows the "working" animation, which
 * reads just as well for "composing an answer" as it does for whatever it
 * was authored for.
 */
const TARGETS = {
  idle: { animation: "idle" },
  listening: { animation: "listening" },
  drowsy: { expression: "drowsy-closed" },
  sleeping: { animation: "sleeping" },
  waking: { animation: "waking-up" },
  thinking: { animation: "thinking" },
  searching: { animation: "working" },
  pleased: { expression: "joyful-wide" },
  error: { expression: "uneasy-left" },
} as const satisfies Record<FreddyState, { animation: Animation } | { expression: Expression }>

/** How long the post-answer smile holds before falling back to idle. */
const PLEASED_MS = 1800
/** Silence before Freddy starts nodding off, then before he's fully asleep. */
const DROWSY_AFTER_MS = 20_000
const SLEEP_AFTER_MS = 40_000
/** Matches the `waking-up` animation's own total duration (steps × hold+transition). */
const WAKING_MS = 3200

/**
 * Derives Freddy's state from the chat's.
 *
 * Lives next to the avatar rather than in the panel so the mapping stays in
 * one place. Priority, most urgent first: an error always wins; a one-shot
 * wake plays out once before anything else can show; being busy (waiting or
 * streaming) beats the transient post-answer smile, which beats the
 * visitor's own composing state; only once none of those apply does the
 * inactivity clock get to show drowsy/sleeping.
 */
export function useFreddyState({
  waiting,
  streaming,
  activeTool,
  listening,
  error,
}: {
  waiting: boolean
  streaming: boolean
  activeTool: string | null
  listening: boolean
  error: boolean
}): FreddyState {
  const busy = waiting || streaming
  const engaged = busy || listening || error

  const [pleased, setPleased] = useState(false)
  const wasBusy = useRef(busy)
  useEffect(() => {
    const finished = wasBusy.current && !busy && !error
    wasBusy.current = busy
    if (!finished) return
    setPleased(true)
    const timer = setTimeout(() => setPleased(false), PLEASED_MS)
    return () => clearTimeout(timer)
  }, [busy, error])

  const [sleepPhase, setSleepPhase] = useState<"awake" | "drowsy" | "sleeping">("awake")
  const [waking, setWaking] = useState(false)
  const wasEngaged = useRef(engaged)
  useEffect(() => {
    const resumed = !wasEngaged.current && engaged
    wasEngaged.current = engaged
    if (!resumed || sleepPhase === "awake") return

    setSleepPhase("awake")
    setWaking(true)
    const timer = setTimeout(() => setWaking(false), WAKING_MS)
    return () => clearTimeout(timer)
  }, [engaged, sleepPhase])

  // The inactivity clock only runs once nothing else is claiming the face.
  const resting = !engaged && !pleased && !waking
  useEffect(() => {
    if (!resting) return
    const drowsyTimer = setTimeout(() => setSleepPhase("drowsy"), DROWSY_AFTER_MS)
    const sleepTimer = setTimeout(() => setSleepPhase("sleeping"), DROWSY_AFTER_MS + SLEEP_AFTER_MS)
    return () => {
      clearTimeout(drowsyTimer)
      clearTimeout(sleepTimer)
    }
  }, [resting])

  if (error) return "error"
  if (waking) return "waking"
  if (busy) return !activeTool && streaming ? "searching" : "thinking"
  if (pleased) return "pleased"
  if (listening) return "listening"
  if (sleepPhase !== "awake") return sleepPhase
  return "idle"
}

export function Freddy({
  state = "idle",
  size = "100%",
  className,
  ariaLabel = "Freddy",
}: {
  state?: FreddyState
  size?: number | string
  className?: string
  ariaLabel?: string
}) {
  if (!definition) {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        className={cn("grid shrink-0 place-items-center text-foreground", className)}
        style={{ width: size, height: size }}
      >
        <HugeiconsIcon icon={ChatBotIcon} className="size-[70%]" />
      </span>
    )
  }

  return (
    <AvatarCanvas
      definition={definition}
      finish="clay"
      {...TARGETS[state]}
      size={size}
      ariaLabel={ariaLabel}
      className={cn("shrink-0", className)}
    />
  )
}
