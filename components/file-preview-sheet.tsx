"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import type { Chunk } from "@/lib/types"

interface FilePreviewSheetProps {
  open: boolean
  fileId: string | null
  fileName: string | null
  chunkId?: string
  onOpenChange: (open: boolean) => void
}

interface ChunksResponse {
  ok: boolean
  data?: { chunkCount: number; chunks: Chunk[] }
  error?: string
}

interface FetchResult {
  forFileId: string
  chunks?: Chunk[]
  error?: boolean
}

export function FilePreviewSheet({
  open,
  fileId,
  fileName,
  chunkId,
  onOpenChange,
}: FilePreviewSheetProps) {
  const { t } = useLanguage()
  const [result, setResult] = useState<FetchResult | null>(null)
  const targetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open || !fileId) return
    if (result?.forFileId === fileId) return

    const controller = new AbortController()
    fetch(`/api/files/${fileId}/chunks`, { signal: controller.signal })
      .then(async (res) => {
        const json: ChunksResponse = await res.json()
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.error ?? `HTTP ${res.status}`)
        }
        setResult({ forFileId: fileId, chunks: json.data.chunks })
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return
        // Log the raw error for debugging; UI surfaces a translated message only.
        console.error("[file-preview] failed to load chunks", err)
        setResult({ forFileId: fileId, error: true })
      })

    return () => controller.abort()
  }, [open, fileId, result])

  const status: "idle" | "loading" | "ready" | "error" = useMemo(() => {
    if (!open || !fileId) return "idle"
    if (result?.forFileId !== fileId) return "loading"
    if (result.error) return "error"
    if (result.chunks) return "ready"
    return "loading"
  }, [open, fileId, result])

  const chunks = useMemo(
    () => (status === "ready" ? result?.chunks ?? [] : []),
    [status, result],
  )

  useEffect(() => {
    if (status !== "ready" || !chunkId) return
    const el = targetRef.current
    if (!el) return
    const id = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    return () => cancelAnimationFrame(id)
  }, [status, chunkId, chunks])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="truncate pr-8 text-base font-semibold text-foreground" title={fileName ?? undefined}>
            {fileName ?? t.filePreview.title}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {status === "loading" && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t.filePreview.loading}</span>
            </div>
          )}

          {status === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p>{t.filePreview.loadFailed}</p>
            </div>
          )}

          {status === "ready" && chunks.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t.filePreview.empty}
            </div>
          )}

          {status === "ready" && chunks.length > 0 && (
            <article className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
              {chunks.map((chunk) => {
                const isTarget = chunk.id === chunkId
                if (isTarget) {
                  return (
                    <mark
                      key={chunk.id}
                      ref={targetRef}
                      className="box-decoration-clone rounded-[3px] bg-primary/15 px-0.5 text-foreground ring-1 ring-primary/30 scroll-mt-6"
                    >
                      {chunk.text}
                    </mark>
                  )
                }
                return <span key={chunk.id}>{chunk.text}</span>
              })}
            </article>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
