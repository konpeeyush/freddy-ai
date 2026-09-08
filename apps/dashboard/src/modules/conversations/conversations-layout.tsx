import { Outlet } from "react-router-dom"

import { ConversationsPanel } from "./conversations-panel"

export function ConversationsLayout() {
  return (
    <div className="flex h-full flex-1">
      <div className="h-full w-full max-w-sm shrink-0 border-r">
        <ConversationsPanel />
      </div>
      <div className="h-full flex-1">
        <Outlet />
      </div>
    </div>
  )
}
