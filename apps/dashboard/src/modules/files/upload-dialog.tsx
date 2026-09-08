import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, File01Icon, Upload01Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { uploadDocument } from "@workspace/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"

const ACCEPTED_EXTENSIONS = [".pdf", ".csv", ".txt", ".md"]

export function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [category, setCategory] = useState("")

  const handleFileSelected = (file: File | undefined) => {
    if (!file) return
    setSelectedFile(file)
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setIsUploading(true)
    try {
      await uploadDocument({
        baseUrl: API_BASE_URL,
        tenantId: TENANT_ID,
        file: selectedFile,
        filename: selectedFile.name,
        category: category || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      handleCancel()
    } catch (error) {
      toast.error("Upload failed")
      console.error(error)
    } finally {
      setIsUploading(false)
    }
  }

  const handleCancel = () => {
    onOpenChange(false)
    setSelectedFile(null)
    setCategory("")
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleCancel())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload documents to your knowledge base for AI-powered search and retrieval. PDF
            extraction is text-only — a scanned or image-heavy PDF may yield little or nothing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              className="w-full"
              id="category"
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Documentation, Support, Product"
              type="text"
              value={category}
            />
          </div>

          <input
            accept={ACCEPTED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
            ref={fileInputRef}
            type="file"
          />

          {selectedFile ? (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border bg-muted/50 p-4">
              <div className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon icon={File01Icon} className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm" title={selectedFile.name}>
                  {selectedFile.name}
                </span>
              </div>
              <Button
                onClick={() => setSelectedFile(null)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
              </Button>
            </div>
          ) : (
            <button
              className={cn(
                "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors disabled:cursor-not-allowed",
                isDragging ? "border-primary bg-accent" : "border-input hover:bg-accent/50"
              )}
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              onDragLeave={(e) => {
                e.preventDefault()
                setIsDragging(false)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                handleFileSelected(e.dataTransfer.files?.[0])
              }}
              type="button"
            >
              <HugeiconsIcon icon={Upload01Icon} className="size-6 text-muted-foreground" />
              <p className="text-sm">Drag & drop a file here, or click to browse</p>
              <p className="text-xs text-muted-foreground">PDF, Markdown, CSV or TXT</p>
            </button>
          )}
        </div>

        <DialogFooter>
          <Button disabled={isUploading} onClick={handleCancel} variant="outline">
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!selectedFile || isUploading}>
            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
