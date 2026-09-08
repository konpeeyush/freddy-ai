import { ChatPanel } from "../chat/panel"

/** Fullscreen: covers the viewport. Useful for mobile or a dedicated route. */
export function FullscreenContainer({ onClose }: { onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[2147483000] flex flex-col bg-background">
      <ChatPanel onClose={onClose} centered />
    </div>
  )
}
