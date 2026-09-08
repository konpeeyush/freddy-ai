import { useInfiniteQuery } from "@tanstack/react-query"
import { NavLink, useParams } from "react-router-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { InboxIcon } from "@hugeicons/core-free-icons"

import { listConversations } from "@workspace/api"
import { useInfiniteScroll } from "@workspace/ui/hooks/use-infinite-scroll"
import { InfiniteScrollTrigger } from "@workspace/ui/components/infinite-scroll-trigger"
import { DicebearAvatar } from "@workspace/ui/components/dicebear-avatar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { paginationStatus } from "@/lib/pagination"

const PAGE_SIZE = 15

export function ConversationsPanel() {
  const { conversationId } = useParams()

  const query = useInfiniteQuery({
    queryKey: ["conversations"],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      listConversations({
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 5000,
  })

  const { topElementRef, handleLoadMore, canLoadMore, isLoadingMore } =
    useInfiniteScroll({
      status: paginationStatus({
        isLoading: query.isLoading,
        isFetchingNextPage: query.isFetchingNextPage,
        hasNextPage: query.hasNextPage,
      }),
      loadMore: () => query.fetchNextPage(),
      loadSize: PAGE_SIZE,
    })

  const conversations = query.data?.pages.flatMap((page) => page.items) ?? []
  // A single page that was never followed by a "load more" doesn't need an
  // end-of-list marker — "No more items" only means something once the
  // visitor has actually paged through something.
  const everPaginated = (query.data?.pages.length ?? 0) > 1

  return (
    <div className="flex h-full w-full flex-col bg-background text-sidebar-foreground">
      <div className="flex h-[53px] shrink-0 items-center border-b px-4">
        <h2 className="text-sm font-semibold">Conversations</h2>
      </div>

      {query.isLoading ? (
        <SkeletonConversations />
      ) : conversations.length === 0 ? (
        <Empty className="flex-1 border-none p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={InboxIcon} />
            </EmptyMedia>
            <EmptyTitle>No conversations</EmptyTitle>
            <EmptyDescription>
              Conversations started from your embedded widget will show up here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-0 text-sm">
                {conversations.map((conversation) => {
                  const active = conversationId === conversation.id

                  return (
                    <MessageScrollerItem
                      key={conversation.id}
                      messageId={conversation.id}
                    >
                      <NavLink
                        to={`/conversations/${conversation.id}`}
                        className={cn(
                          "relative flex cursor-pointer items-start gap-3 border-b p-4 py-5 text-sm leading-tight hover:bg-accent hover:text-accent-foreground",
                          active && "bg-accent text-accent-foreground"
                        )}
                      >
                        <div
                          className={cn(
                            "absolute top-1/2 left-0 h-[64%] w-1 -translate-y-1/2 rounded-r-full bg-primary opacity-0 transition-opacity",
                            active && "opacity-100"
                          )}
                        />
                        <DicebearAvatar seed={conversation.id} size={40} className="shrink-0" />
                        <div className="flex-1 overflow-hidden">
                          <div className="flex w-full items-center gap-2">
                            <span className="truncate font-bold">
                              {conversation.visitorName || "Visitor"}
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {conversation.lastMessageAt
                                ? formatRelativeTime(conversation.lastMessageAt)
                                : formatRelativeTime(conversation.createdAt)}
                            </span>
                          </div>
                          <div className="mt-1">
                            <span className="line-clamp-1 text-xs text-muted-foreground">
                              {conversation.lastMessagePreview || "No messages yet"}
                            </span>
                          </div>
                        </div>
                      </NavLink>
                    </MessageScrollerItem>
                  )
                })}
                {canLoadMore || isLoadingMore || everPaginated ? (
                  <InfiniteScrollTrigger
                    canLoadMore={canLoadMore}
                    isLoadingMore={isLoadingMore}
                    onLoadMore={handleLoadMore}
                    ref={topElementRef}
                  />
                ) : null}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      )}
    </div>
  )
}

function SkeletonConversations() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      <div className="relative flex w-full min-w-0 flex-col p-2">
        <div className="w-full space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="flex items-start gap-3 rounded-lg p-4" key={index}>
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex w-full items-center gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-3 w-12 shrink-0" />
                </div>
                <div className="mt-2">
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
