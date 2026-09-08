import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import { cancelIngest, ingestUrl } from "@workspace/api"
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
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import { API_BASE_URL, TENANT_ID } from "@/lib/api"

type LogLine = { kind: string; text: string; detail?: string }
type Counts = { pages: number; chunks: number; skipped: number }
/** The terminal outcome of a run — separate from `log`/`counts`, which keep
 *  updating throughout, so the dialog can show one clear "it's finished, and
 *  here's what happened" state rather than making the reader infer that from
 *  the last line of a scrolling log. */
type Result =
  | { kind: "done"; pages: number; chunks: number; unchanged: number; skipped: number }
  | { kind: "error"; message: string }

const EMPTY_COUNTS: Counts = { pages: 0, chunks: 0, skipped: 0 }

function summarize(result: Extract<Result, { kind: "done" }>): string {
  const parts = [
    `${result.pages} page${result.pages === 1 ? "" : "s"}`,
    `${result.chunks} chunk${result.chunks === 1 ? "" : "s"}`,
  ]
  if (result.unchanged) parts.push(`${result.unchanged} unchanged`)
  if (result.skipped) parts.push(`${result.skipped} skipped`)
  return parts.join(" · ")
}

export function AddLinkDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()

  const [url, setUrl] = useState("")
  const [maxPages, setMaxPages] = useState(60)
  const [prune, setPrune] = useState(false)
  const [urlError, setUrlError] = useState("")

  const [ingesting, setIngesting] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS)
  const [result, setResult] = useState<Result | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function append(kind: string, text: string, detail?: string) {
    setLog((prev) => [...prev, { kind, text, detail }])
  }

  async function handleIngest() {
    if (ingesting) return
    // Validated here as well as on the server so the common mistake — a bare
    // hostname with no scheme — is named next to the field, not a generic 400.
    try {
      new URL(url)
      setUrlError("")
    } catch {
      setUrlError("Needs a full url, including https://")
      return
    }

    setLog([])
    setCounts(EMPTY_COUNTS)
    setResult(null)
    setIngesting(true)
    const controller = new AbortController()
    abortRef.current = controller

    let pages = 0
    let chunks = 0
    let skipped = 0

    try {
      for await (const event of ingestUrl(
        { baseUrl: API_BASE_URL, url, tenantId: TENANT_ID, maxPages, prune },
        controller.signal
      )) {
        switch (event.kind) {
          case "start":
            append("start", event.origin)
            break
          case "page":
            pages++
            chunks += event.chunks
            append("page", event.title || event.url, `${event.chunks} chunks`)
            break
          case "unchanged":
            append("same", event.url, "already indexed")
            break
          case "skip":
            skipped++
            append("skip", event.url, event.reason)
            break
          case "error": {
            append("error", event.message)
            const outcome: Result = { kind: "error", message: event.message }
            setResult(outcome)
            toast.error(outcome.message)
            break
          }
          case "done": {
            append("done", "finished")
            const outcome: Result = {
              kind: "done",
              pages: event.pages,
              chunks: event.chunks,
              unchanged: event.unchanged,
              skipped: event.skipped,
            }
            setCounts({ pages: event.pages, chunks: event.chunks, skipped: event.skipped })
            setResult(outcome)
            toast.success(`Indexed ${url}`, { description: summarize(outcome) })
            break
          }
        }
        if (event.kind !== "done") setCounts({ pages, chunks, skipped })
      }
    } catch (cause) {
      // An abort is the Stop button working, not a failure.
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "ingest failed"
        append("error", message)
        setResult({ kind: "error", message })
        toast.error(message)
      }
    } finally {
      setIngesting(false)
      abortRef.current = null
      queryClient.invalidateQueries({ queryKey: ["rag-sources"] })
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
    // Told server-side too: aborting the fetch only closes the client's end
    // of the stream — the crawl keeps running server-side until told to stop.
    cancelIngest({ baseUrl: API_BASE_URL, tenantId: TENANT_ID }).catch(() => {})
    append("stopped", "cancelled")
  }

  function handleClose() {
    if (ingesting) return
    onOpenChange(false)
    setUrl("")
    setMaxPages(60)
    setPrune(false)
    setUrlError("")
    setLog([])
    setCounts(EMPTY_COUNTS)
    setResult(null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(next) : handleClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Link</DialogTitle>
          <DialogDescription>
            Crawl a site and index it for your AI assistant. A path scopes the crawl — a URL
            ending in <code>/docs</code> indexes the docs and leaves the rest of the site alone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              type="url"
              autoComplete="off"
              placeholder="https://docs.example.com"
              value={url}
              disabled={ingesting}
              onChange={(e) => setUrl(e.target.value)}
            />
            {urlError ? <p className="text-sm text-destructive">{urlError}</p> : null}
          </div>

          <div className="flex items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="link-max-pages">Max pages</Label>
              <Input
                id="link-max-pages"
                type="number"
                min={1}
                max={500}
                className="w-28"
                value={maxPages}
                disabled={ingesting}
                onChange={(e) => setMaxPages(Number(e.target.value) || 1)}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={prune}
                disabled={ingesting}
                onChange={(e) => setPrune(e.target.checked)}
              />
              Remove pages no longer found
            </label>
          </div>

          {log.length ? (
            <div className="space-y-2">
              {/* The terminal state gets its own banner — a glance says
                  "finished, and here's what happened" without reading the
                  log. While still running, the plain running count does
                  that job instead. */}
              {result ? (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm",
                    result.kind === "done"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                >
                  <HugeiconsIcon
                    icon={result.kind === "done" ? CheckmarkCircle02Icon : AlertCircleIcon}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <p className="min-w-0 flex-1">
                    {result.kind === "done" ? `Indexed ${summarize(result)}` : result.message}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {counts.pages} page{counts.pages === 1 ? "" : "s"} · {counts.chunks} chunk
                  {counts.chunks === 1 ? "" : "s"}
                  {counts.skipped ? ` · ${counts.skipped} skipped` : ""}
                </p>
              )}
              <ScrollArea className="h-40 rounded-lg border bg-muted/50">
                <ol className="space-y-1 p-3 text-xs">
                  {log.map((line, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      <span
                        className={cn(
                          "shrink-0 font-mono uppercase",
                          line.kind === "error" && "text-destructive",
                          line.kind === "done" && "text-primary"
                        )}
                      >
                        {line.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{line.text}</span>
                      {line.detail ? (
                        <span className="shrink-0 text-muted-foreground">{line.detail}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {ingesting ? (
            <Button onClick={handleCancel} variant="outline">
              Stop
            </Button>
          ) : (
            <Button onClick={handleClose} variant="outline">
              Close
            </Button>
          )}
          <Button onClick={handleIngest} disabled={!url || ingesting}>
            {ingesting ? "Ingesting..." : "Ingest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
