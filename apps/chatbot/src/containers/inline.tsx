import { ChatPanel } from "../chat/panel"

/**
 * Inline container: fills the host element. No trigger, no close button —
 * the page author already allocated space for it, so it is always open.
 *
 * Requires the host to have a definite height, which mount.tsx guarantees
 * (a real page-given height, or a viewport-height fallback) — `h-full` is a
 * fixed size against that, not a content-based one, so a long transcript
 * overflows into the message list's own scroller instead of growing this box.
 */
export function InlineContainer() {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <ChatPanel />
    </div>
  )
}
