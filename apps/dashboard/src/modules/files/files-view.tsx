import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Delete02Icon,
  File01Icon,
  LibraryIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

import { listDocuments, type Document } from "@workspace/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { useInfiniteScroll } from "@workspace/ui/hooks/use-infinite-scroll"
import { InfiniteScrollTrigger } from "@workspace/ui/components/infinite-scroll-trigger"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { paginationStatus } from "@/lib/pagination"
import { UploadDialog } from "./upload-dialog"
import { DeleteFileDialog } from "./delete-file-dialog"

const PAGE_SIZE = 15

const STATUS_VARIANT: Record<Document["status"], "outline" | "secondary" | "destructive"> = {
  processing: "secondary",
  ready: "outline",
  failed: "destructive",
}

export function FilesView() {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null)

  const query = useInfiniteQuery({
    queryKey: ["documents"],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      listDocuments({
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    // Processing documents finish in well under this window; a short poll
    // is enough to flip "processing" to "ready" without any push mechanism.
    refetchInterval: 4000,
  })

  const documents = query.data?.pages.flatMap((page) => page.items) ?? []

  const { topElementRef, handleLoadMore, canLoadMore, isLoadingMore } = useInfiniteScroll({
    status: paginationStatus({
      isLoading: query.isLoading,
      isFetchingNextPage: query.isFetchingNextPage,
      hasNextPage: query.hasNextPage,
    }),
    loadMore: () => query.fetchNextPage(),
    loadSize: PAGE_SIZE,
  })

  return (
    <>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <DeleteFileDialog
        document={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />

      <div className="flex min-h-screen flex-col bg-muted p-8">
        <div className="mx-auto w-full max-w-screen-md">
          <div className="space-y-2">
            <h1 className="text-2xl md:text-4xl">Knowledge Base</h1>
            <p className="text-muted-foreground">
              Upload and manage documents for your AI assistant
            </p>
          </div>

          <div className="mt-8 rounded-lg border bg-background">
            <div className="flex items-center justify-end border-b px-6 py-4">
              <Button onClick={() => setUploadOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} />
                Add New
              </Button>
            </div>
            {query.isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <Empty className="border-none py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={LibraryIcon} />
                  </EmptyMedia>
                  <EmptyTitle>No documents yet</EmptyTitle>
                  <EmptyDescription>
                    Upload a PDF, Markdown, CSV or text file to give your assistant
                    something to search when it answers questions.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setUploadOpen(true)}>
                    <HugeiconsIcon icon={PlusSignIcon} />
                    Upload a document
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-6 py-4 font-medium">Name</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Type</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Size</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Status</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow className="hover:bg-muted/50" key={document.id}>
                      <TableCell className="max-w-64 px-6 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <HugeiconsIcon
                            icon={File01Icon}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate" title={document.filename}>
                            {document.filename}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge className="uppercase" variant="outline">
                          {document.mimeType.split("/").pop() || "file"}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">
                        {formatBytes(document.sizeBytes)}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {document.status === "failed" && document.error ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Badge variant={STATUS_VARIANT[document.status]} className="capitalize">
                                  {document.status}
                                </Badge>
                              }
                            />
                            <TooltipContent>{document.error}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant={STATUS_VARIANT[document.status]} className="capitalize">
                            {document.status}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                className="size-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(document)}
                                size="sm"
                                variant="ghost"
                              >
                                <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent>Delete file</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!query.isLoading && documents.length > 0 ? (
              <div className="border-t">
                <InfiniteScrollTrigger
                  canLoadMore={canLoadMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={handleLoadMore}
                  ref={topElementRef}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
