import { useEffect, useRef, useState } from "react"

/*
 * Text that resolves out of blur as it streams in.
 *
 * The chunks from the server arrive at unpredictable sizes — sometimes a few
 * characters, sometimes a whole paragraph. So words are split at render and
 * only the ones that are *new since the last chunk* animate; re-animating
 * settled text would make the whole message flicker on every chunk.
 *
 * Markdown is deliberately not parsed here. Re-parsing on every chunk would
 * both cost a full sanitise pass ~30 times a second and briefly show
 * half-written syntax (a `|` before its table row closes). The panel swaps in
 * the rendered markdown once the reply completes.
 */

/**
 * How long one chunk's sweep may take, however many words it carried.
 *
 * The stagger used to be a flat per-word delay clamped at a ceiling, which
 * meant every word past the eleventh in a chunk started at the *same* moment —
 * so a large chunk read as a short sweep followed by a block landing at once,
 * the exact effect the stagger exists to avoid. Dividing a fixed budget by the
 * chunk's own size keeps it a sweep at any size.
 */
const SWEEP_MS = 260

/** Ceiling on the per-word step, so a two-word chunk is not sluggish. */
const MAX_STEP_MS = 32

/** Split on whitespace but keep it, so paragraph breaks survive. */
function splitWords(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean)
}

export function StreamingText({ text }: { text: string }) {
  const words = splitWords(text)

  /*
   * How many words were already on screen last render. Everything past this
   * index is new and gets the blur; everything before it is settled and must
   * be left alone.
   */
  const settledRef = useRef(0)
  const [settled, setSettled] = useState(0)

  useEffect(() => {
    settledRef.current = words.length
    // Deferred so the new words mount mid-animation rather than pre-settled.
    const frame = requestAnimationFrame(() => setSettled(settledRef.current))
    return () => cancelAnimationFrame(frame)
  }, [words.length])

  const arriving = Math.max(words.length - settled, 1)
  const step = Math.min(MAX_STEP_MS, SWEEP_MS / arriving)

  return (
    <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
      {words.map((word, i) =>
        /\s/.test(word) ? (
          <span key={i}>{word}</span>
        ) : (
          <span
            key={i}
            className="inline-block"
            style={
              i < settled
                ? undefined
                : {
                    animation:
                      "widget-word-in 380ms cubic-bezier(0.22,0.61,0.36,1) both",
                    animationDelay: `${Math.round((i - settled) * step)}ms`,
                  }
            }
          >
            {word}
          </span>
        )
      )}
      <span
        aria-hidden
        className="ms-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 rounded-full bg-foreground align-middle"
        style={{ animation: "widget-caret 1.1s ease-in-out infinite" }}
      />
    </p>
  )
}
