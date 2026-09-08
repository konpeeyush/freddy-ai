import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { FreddyLogo } from "@/components/freddy-logo"

export function ConversationsEmptyView() {
  return (
    <div className="flex h-full flex-1 items-center justify-center bg-muted">
      <Empty className="border-none">
        <EmptyHeader>
          <FreddyLogo size={80} className="mb-1" />
          <EmptyTitle>freddy-ai</EmptyTitle>
          <EmptyDescription>
            Select a conversation on the left to see its transcript.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
