import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { deleteSource, type RagSource } from "@workspace/api"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"

export function DeleteSourceDialog({
  source,
  onOpenChange,
}: {
  source: RagSource | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!source) return
    setIsDeleting(true)
    try {
      await deleteSource({ baseUrl: API_BASE_URL, origin: source.origin, tenantId: TENANT_ID })
      queryClient.invalidateQueries({ queryKey: ["rag-sources"] })
      onOpenChange(false)
    } catch (error) {
      toast.error("Could not delete link")
      console.error(error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Link</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this link? Every page indexed from it will be
            removed and no longer searchable by the assistant. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {source ? (
          <div className="min-w-0 px-6 py-4">
            <div className="min-w-0 rounded-lg border bg-muted/50 p-4">
              <p className="truncate font-medium" title={source.origin}>
                {source.origin}
              </p>
              <p className="text-sm text-muted-foreground">
                {source.pages} page{source.pages === 1 ? "" : "s"} · {source.chunks} chunk
                {source.chunks === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={isDeleting} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={isDeleting || !source} onClick={handleDelete} variant="destructive">
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
