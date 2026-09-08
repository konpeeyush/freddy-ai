import { useCallback, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"

import { cn } from "@workspace/ui/lib/utils"

import { useFormContext, useWidgetRuntime } from "../context"
import { asText } from "../resolve"
import { ActionSchema } from "../tree"
import { BUTTON_COLOR, BUTTON_SIZE, dimension, token } from "../tokens"
import { ICONS } from "./icons"
import type { PrimitiveProps } from "./layout"

/*
 * Button — the action carrier.
 *
 * Everything interesting about widget interaction lands here: running the
 * action, reflecting the host's acknowledgment, and refusing to fire twice.
 */

type Phase = "idle" | "pending" | "done" | "failed"

export function Button({ props }: PrimitiveProps) {
  const runtime = useWidgetRuntime()
  const form = useFormContext()
  const [phase, setPhase] = useState<Phase>("idle")
  const [failure, setFailure] = useState<string | null>(null)
  /*
   * Guards a double-click during the await. React state updates are async, so
   * checking `phase` inside the handler can still let a second click through
   * before the re-render lands — for a booking or a payment that would be a
   * duplicate submission.
   */
  const inFlight = useRef(false)

  const label = asText(props.label)

  const parsed = ActionSchema.safeParse(props.onClickAction)
  const action = parsed.success ? parsed.data : null

  const onClick = useCallback(async () => {
    if (!action || inFlight.current) return

    let payload: Record<string, unknown> =
      (props.onClickAction as { additionalInputs?: Record<string, unknown> })
        ?.additionalInputs ?? {}

    // A submit gathers the enclosing form first; a failed validation must not
    // reach the host at all.
    if (action.kind === "submit") {
      if (!form) {
        console.warn("[widgets] submit action outside a Form")
        return
      }
      const result = form.validate()
      if (!result.ok) return
      payload = { ...payload, ...result.values }
    }

    inFlight.current = true
    setFailure(null)
    setPhase("pending")

    try {
      await runtime.run({ action, label, payload })
      setPhase("done")
    } catch (cause) {
      setPhase("failed")
      setFailure(
        cause instanceof Error && cause.message ? cause.message : "That didn't work"
      )
      // A failure must be retryable — re-arm rather than locking the button.
      inFlight.current = false
    }
  }, [action, form, label, props.onClickAction, runtime])

  if (!label) return null

  const width = dimension(props.width)
  const block = props.block === true

  const busy =
    phase === "pending" ||
    // `loadingBehavior: "widget"` puts every control in the widget in the
    // pending state, not just the one that was clicked.
    (runtime.widgetBusy && phase !== "done")

  const locked = phase === "done" || runtime.disabled

  return (
    <div className={cn("flex flex-col gap-1", block ? "w-full" : "w-fit")}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || locked || !action}
        aria-busy={busy}
        style={{ width: width ?? (block ? "100%" : undefined) }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-all outline-none select-none",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-60",
          "active:translate-y-px",
          token(BUTTON_SIZE, props.size, BUTTON_SIZE.md),
          token(BUTTON_COLOR, props.color, BUTTON_COLOR.primary)
        )}
      >
        {busy ? (
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : phase === "done" ? (
          <HugeiconsIcon icon={ICONS.check} className="size-3.5" />
        ) : props.icon && ICONS[asText(props.icon)] ? (
          <HugeiconsIcon icon={ICONS[asText(props.icon)]} className="size-3.5" />
        ) : null}
        {phase === "done" && props.doneLabel ? asText(props.doneLabel) : label}
      </button>

      {failure ? (
        <p className="text-xs text-destructive" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  )
}
