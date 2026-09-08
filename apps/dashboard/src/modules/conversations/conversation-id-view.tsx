import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"

import { pollMessages, type StoredMessage } from "@workspace/api"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { MessageBubble } from "@workspace/ui/components/message-bubble"
import { Markdown } from "@workspace/ui/components/chat/markdown"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@workspace/ui/components/message-scroller"
import { cn } from "@workspace/ui/lib/utils"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"

function MessageList({ messages }: { messages: StoredMessage[] }) {
  const { scrollToEnd } = useMessageScroller()
  const lastId = messages[messages.length - 1]?.id

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" }))
    return () => cancelAnimationFrame(frame)
  }, [lastId, scrollToEnd])

  return (
    <MessageScroller className="flex-1">
      <MessageScrollerViewport>
        <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4">
          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10 text-center text-sm text-muted-foreground">
              No messages yet
            </div>
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  className="flex justify-end ps-8 pe-3.5"
                >
                  <MessageBubble variant="sent" message={message.text} className="text-sm" />
                </MessageScrollerItem>
              ) : (
                <MessageScrollerItem key={message.id} messageId={message.id} className="min-w-0">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    {message.sender === "operator" ? "Operator" : "Assistant"}
                  </div>
                  <Markdown content={message.text} />
                </MessageScrollerItem>
              )
            )
          )}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton />
    </MessageScroller>
  )
}

export function ConversationIdView({ conversationId }: { conversationId: string }) {
  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", conversationId],
    queryFn: () => pollMessages(conversationId, { baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
    refetchInterval: 3000,
  })

  const messages = messagesQuery.data?.messages ?? []

  if (messagesQuery.isLoading) {
    return <ConversationIdViewLoading />
  }

  return (
    <div className="flex h-full flex-col bg-muted">
      <MessageScrollerProvider autoScroll>
        <MessageList messages={messages} />
      </MessageScrollerProvider>
    </div>
  )
}

function ConversationIdViewLoading() {
  return (
    <div className="flex h-full flex-col bg-muted">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 p-4">
        {Array.from({ length: 6 }, (_, index) => {
          const isUser = index % 2 === 0
          const widths = ["w-48", "w-60", "w-72"]
          const width = widths[index % widths.length]
          return (
            <div
              key={index}
              className={cn("flex w-full", isUser ? "justify-end ps-8 pe-3.5" : "min-w-0")}
            >
              <Skeleton className={`h-9 ${width} rounded-lg`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
