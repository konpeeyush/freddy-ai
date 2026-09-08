import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import {
  appendMessage,
  getConversation,
  pollMessages,
  updateConversationStatus,
  type ConversationStatus,
  type StoredMessage,
} from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
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
import { ConversationStatusButton } from "./conversation-status-button"

const STATUS_CYCLE: Record<ConversationStatus, ConversationStatus> = {
  unresolved: "escalated",
  escalated: "resolved",
  resolved: "unresolved",
}

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
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const conversationQuery = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversation(conversationId, { baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
    refetchInterval: 5000,
  })

  const messagesQuery = useQuery({
    queryKey: ["conversation-messages", conversationId],
    queryFn: () => pollMessages(conversationId, { baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
    refetchInterval: 3000,
  })

  const conversation = conversationQuery.data
  const messages = messagesQuery.data?.messages ?? []
  const resolved = conversation?.status === "resolved"

  const handleToggleStatus = async () => {
    if (!conversation) return
    setUpdatingStatus(true)
    try {
      await updateConversationStatus(conversationId, {
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        status: STATUS_CYCLE[conversation.status],
      })
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] })
      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    } catch (error) {
      toast.error("Could not update status")
      console.error(error)
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await appendMessage(conversationId, {
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        message: {
          id: crypto.randomUUID(),
          role: "agent",
          sender: "operator",
          text,
        },
      })
      setDraft("")
      queryClient.invalidateQueries({ queryKey: ["conversation-messages", conversationId] })
      queryClient.invalidateQueries({ queryKey: ["conversations"] })
    } catch (error) {
      toast.error("Message failed to send")
      console.error(error)
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  if (conversationQuery.isLoading || messagesQuery.isLoading) {
    return <ConversationIdViewLoading />
  }

  return (
    <div className="flex h-full flex-col bg-muted">
      <header className="flex items-center justify-end border-b bg-background p-2.5">
        {conversation ? (
          <ConversationStatusButton
            status={conversation.status}
            onClick={handleToggleStatus}
            disabled={updatingStatus}
          />
        ) : null}
      </header>

      <MessageScrollerProvider autoScroll>
        <MessageList messages={messages} />
      </MessageScrollerProvider>

      <div className="border-t bg-background p-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={resolved || sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={
              resolved
                ? "This conversation has been resolved"
                : "Type your response as an operator..."
            }
            className={cn("min-h-11 flex-1 resize-none")}
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={resolved || sending || !draft.trim()}
            size="icon"
            aria-label="Send reply"
          >
            <HugeiconsIcon icon={SentIcon} className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConversationIdViewLoading() {
  return (
    <div className="flex h-full flex-col bg-muted">
      <header className="flex items-center justify-end border-b bg-background p-2.5">
        <Skeleton className="h-8 w-24" />
      </header>
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
      <div className="border-t bg-background p-3">
        <Skeleton className="mx-auto h-11 w-full max-w-3xl" />
      </div>
    </div>
  )
}
