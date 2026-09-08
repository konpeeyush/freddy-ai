import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon, Globe02Icon, PlusSignIcon } from "@hugeicons/core-free-icons"

import { listSources, type RagSource } from "@workspace/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { AddLinkDialog } from "./add-link-dialog"
import { DeleteSourceDialog } from "./delete-source-dialog"

export function LinksView() {
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RagSource | null>(null)

  const query = useQuery({
    queryKey: ["rag-sources"],
    queryFn: () => listSources({ baseUrl: API_BASE_URL, tenantId: TENANT_ID }),
    // An ingest can flip a row from nothing to indexed while the dialog is
    // open above this list — the same short poll the Files tab uses to
    // watch "processing" turn into "ready".
    refetchInterval: 4000,
  })

  const sources = query.data?.sources ?? []
  const ordered = [...sources].sort((a, b) => b.lastIngestedAt - a.lastIngestedAt)

  return (
    <>
      <AddLinkDialog open={addOpen} onOpenChange={setAddOpen} />
      <DeleteSourceDialog
        source={deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />

      <div className="flex min-h-screen flex-col bg-muted p-8">
        <div className="mx-auto w-full max-w-screen-md">
          <div className="space-y-2">
            <h1 className="text-2xl md:text-4xl">Links</h1>
            <p className="text-muted-foreground">
              Crawl sites for your AI assistant to search when it answers questions
            </p>
          </div>

          <div className="mt-8 rounded-lg border bg-background">
            <div className="flex items-center justify-end border-b px-6 py-4">
              <Button onClick={() => setAddOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} />
                Add Link
              </Button>
            </div>
            {query.isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : ordered.length === 0 ? (
              <Empty className="border-none py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HugeiconsIcon icon={Globe02Icon} />
                  </EmptyMedia>
                  <EmptyTitle>No links yet</EmptyTitle>
                  <EmptyDescription>
                    Crawl a documentation site to give your assistant something to search
                    when it answers questions.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setAddOpen(true)}>
                    <HugeiconsIcon icon={PlusSignIcon} />
                    Add a link
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-6 py-4 font-medium">Site</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Pages</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Chunks</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Last indexed</TableHead>
                    <TableHead className="px-6 py-4 font-medium">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordered.map((source) => (
                    <TableRow className="hover:bg-muted/50" key={source.origin}>
                      <TableCell className="max-w-64 px-6 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <HugeiconsIcon
                            icon={Globe02Icon}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <a
                            className="truncate hover:underline"
                            href={source.origin}
                            target="_blank"
                            rel="noreferrer"
                            title={source.origin}
                          >
                            {source.origin}
                          </a>
                        </div>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">
                        {source.pages}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">
                        {source.chunks}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-muted-foreground">
                        {formatRelativeTime(source.lastIngestedAt)}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                className="size-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(source)}
                                size="sm"
                                variant="ghost"
                              >
                                <HugeiconsIcon icon={Delete02Icon} className="size-4" />
                              </Button>
                            }
                          />
                          <TooltipContent>Delete link</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
