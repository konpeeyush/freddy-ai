import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { deleteDocument, type Document } from "@workspace/api"
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
import { formatBytes } from "@/lib/format"

export function DeleteFileDialog({
  document,
  onOpenChange,
}: {
  document: Document | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!document) return
    setIsDeleting(true)
    try {
      await deleteDocument(document.id, { baseUrl: API_BASE_URL, tenantId: TENANT_ID })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      onOpenChange(false)
    } catch (error) {
      toast.error("Could not delete file")
      console.error(error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete File</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this file? This action cannot be undone, and it will
            no longer be searchable by the assistant.
          </DialogDescription>
        </DialogHeader>

        {document ? (
          <div className="min-w-0 px-6 py-4">
            <div className="min-w-0 rounded-lg border bg-muted/50 p-4">
              <p className="truncate font-medium" title={document.filename}>
                {document.filename}
              </p>
              <p className="text-sm text-muted-foreground">
                Type: {document.mimeType.split("/").pop()?.toUpperCase()} | Size:{" "}
                {formatBytes(document.sizeBytes)}
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={isDeleting} onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={isDeleting || !document} onClick={handleDelete} variant="destructive">
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
