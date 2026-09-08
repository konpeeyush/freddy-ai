import { useCallback, useState } from "react"

import { getWidget } from "./registry"
import { Widget } from "./render"
import type { WidgetPayload } from "./tree"

/*
 * The message-part bridge.
 *
 * Takes a stored payload, finds the definition it was written against, and
 * renders it. This is what a chat panel mounts; everything below it is the
 * runtime.
 */

export type WidgetPartProps = {
  payload: WidgetPayload
  locale?: string
  /**
   * Persists replacement data back onto the message. Without it a widget
   * still updates on screen, but the new state is lost when the panel
   * closes — so a host that stores conversations should always pass this.
   */
  onDataChange?: (data: unknown) => void
  onClose?: () => void
}

export function WidgetPart({
  payload,
  locale,
  onDataChange,
  onClose,
}: WidgetPartProps) {
  /*
   * Local data shadows the payload so a widget updates immediately on an
   * action, even when the host has no persistence wired up. `onDataChange`
   * is what makes it durable; this is what makes it responsive.
   */
  const [data, setData] = useState(payload.data)
  const [dismissed, setDismissed] = useState(false)

  /*
   * Stable identities: `Widget` memoises its action runner against these, so
   * inline arrows here would rebuild it on every render and undo the memo.
   */
  const handleDataChange = useCallback(
    (next: unknown) => {
      setData(next)
      onDataChange?.(next)
    },
    [onDataChange]
  )

  const handleClose = useCallback(() => {
    setDismissed(true)
    onClose?.()
  }, [onClose])

  const definition = getWidget(payload.widgetId, payload.version)

  if (dismissed) return null

  if (!definition) {
    // An unregistered widget is normal, not exceptional: history outlives
    // definitions, and a customer can delete one. Fall back to the summary.
    return payload.summary ? (
      <p className="text-sm text-muted-foreground">{payload.summary}</p>
    ) : null
  }

  return (
    <Widget
      definition={definition}
      data={data}
      summary={payload.summary}
      locale={locale}
      onDataChange={handleDataChange}
      onClose={handleClose}
    />
  )
}
