import { ContactPanel } from "./contact-panel"

export function ConversationIdLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-1">
      <div className="flex h-full flex-1 flex-col">{children}</div>
      <div className="hidden h-full w-full max-w-sm shrink-0 border-l lg:block">
        <ContactPanel />
      </div>
    </div>
  )
}
