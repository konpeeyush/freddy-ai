import { Outlet } from "react-router-dom"

import { ConversationsPanel } from "./conversations-panel"

export function ConversationsLayout() {
  return (
    /*
     * Anchored to the viewport rather than `h-full`: the ancestor chain up to
     * `<SidebarProvider>` is `min-h-svh` (grow-to-fit, so other routes can be
     * plain scrolling pages), which never gives this subtree a definite
     * height to inherit — `h-full` here would resolve to "auto" and every
     * nested message scroller would just push the whole page taller instead
     * of clipping and scrolling internally.
     *
     * No `flex-1` alongside `h-screen`: this div is itself a flex item of
     * `<main>` (flex-col), and `flex-1`'s `flex-basis: 0%` would win over the
     * explicit height on that main axis, undoing the clamp it's there for.
     */
    <div className="flex h-screen overflow-hidden">
      <div className="h-full w-full max-w-sm shrink-0 border-r">
        <ConversationsPanel />
      </div>
      <div className="h-full flex-1">
        <Outlet />
      </div>
    </div>
  )
}
