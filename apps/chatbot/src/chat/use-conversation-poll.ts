import { useEffect, useRef } from "react"
import { pollMessages, type ChatMessage } from "@workspace/api"

/** How often the widget checks for an operator reply while a conversation is
 *  open. No realtime infrastructure backs this — a few seconds of latency is
 *  the trade for a stateless server and no websocket/SSE connection to keep
 *  alive per visitor. */
const POLL_INTERVAL_MS = 4000

/**
 * Watches for operator replies landing on the current conversation from the
 * dashboard, while this hook is mounted.
 *
 * Deliberately tied to mount, not a separate "is the panel open" flag: in
 * floating mode `ChatPanel` (and therefore `useChat`, which owns this) is
 * unmounted on close, so polling already stops the moment the panel does.
 * Inline and fullscreen keep the panel mounted for as long as it's visible,
 * which is exactly when polling should keep running.
 */
export function useConversationPoll({
  apiUrl,
  conversationId,
  tenantId,
  onOperatorMessages,
}: {
  apiUrl: string
  conversationId: string
  tenantId?: string
  onOperatorMessages: (messages: ChatMessage[]) => void
}) {
  // Always current inside the interval closure without re-subscribing it.
  const onOperatorMessagesRef = useRef(onOperatorMessages)
  onOperatorMessagesRef.current = onOperatorMessages

  useEffect(() => {
    let baseUrl: string
    try {
      baseUrl = new URL(apiUrl).origin
    } catch {
      return
    }

    let cancelled = false
    let cursor = 0

    async function poll() {
      // No point spending a request on a tab nobody is looking at.
      if (cancelled || document.visibilityState === "hidden") return
      try {
        const { messages } = await pollMessages(conversationId, {
          baseUrl,
          after: cursor || undefined,
          tenantId,
        })
        if (cancelled) return

        for (const message of messages) {
          cursor = Math.max(cursor, message.createdAt)
        }

        const operatorMessages = messages.filter(
          (message) => message.sender === "operator"
        )
        if (operatorMessages.length) {
          onOperatorMessagesRef.current(
            operatorMessages.map((message) => ({
              id: message.id,
              role: message.role,
              text: message.text,
              parts: message.parts,
              sources: message.sources,
            }))
          )
        }
      } catch {
        // A missed poll is invisible and self-heals next tick — never worth
        // surfacing to the visitor as an error.
      }
    }

    const id = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [apiUrl, conversationId, tenantId])
}
