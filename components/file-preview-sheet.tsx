"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { baseMarkdownComponents } from "@/components/markdown/base-components"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { httpClient } from "@/lib/http/client"
import type { Chunk } from "@/lib/types"
import { cn } from "@/lib/utils"

function isMarkdownFile(fileName: string | null): boolean {
  if (!fileName) return false
  return /\.(md|markdown)$/i.test(fileName)
}

/**
 * Rebuild the original document text from its chunks. Chunks arrive ordered by
 * `idx` and overlap by ~50 chars, so naive concatenation would duplicate text at
 * every seam. We use the absolute `meta.start`/`meta.end` offsets to drop the
 * overlapping prefix of each chunk. Falls back to plain joining when offsets are
 * unavailable (older rows). Only used for markdown rendering, where broken
 * mid-element splits would otherwise render incorrectly.
 */
function reconstructText(chunks: Chunk[]): string {
  const hasOffsets = chunks.every(
    (c) => typeof c.meta?.start === "number" && typeof c.meta?.end === "number",
  )
  if (!hasOffsets) return chunks.map((c) => c.text).join("\n")

  let cursor = -1
  let out = ""
  for (const c of chunks) {
    const start = c.meta.start as number
    const end = c.meta.end as number
    if (end <= cursor) continue // fully inside already-emitted range
    if (cursor >= 0 && start > cursor) out += "\n" // seam with no overlap
    const skip = cursor > start ? cursor - start : 0
    out += skip > 0 ? c.text.slice(skip) : c.text
    cursor = end
  }
  return out
}

const markdownComponents: Components = {
  ...baseMarkdownComponents,
  pre: ({ children, className }) => (
    <pre
      className={cn(
        "mt-4 overflow-x-auto rounded-xl border border-border bg-secondary p-4 font-code text-sm leading-6",
        className,
      )}
    >
      {children}
    </pre>
  ),
}

interface FilePreviewSheetProps {
  open: boolean
  fileId: string | null
  fileName: string | null
  chunkId?: string
  onOpenChange: (open: boolean) => void
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
    httpClient
      .get<{ chunkCount: number; chunks: Chunk[] }>(`/api/files/${fileId}/chunks`, {
        signal: controller.signal,
      })
      .then((data) => {
        setResult({ forFileId: fileId, chunks: data.chunks })
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

  const asMarkdown = isMarkdownFile(fileName)
  const markdownText = useMemo(
    () => (asMarkdown && chunks.length > 0 ? reconstructText(chunks) : ""),
    [asMarkdown, chunks],
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
        <SheetHeader className="flex h-13 flex-row items-center border-b border-border px-6">
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

          {status === "ready" && chunks.length > 0 && asMarkdown && (
            <article className="wrap-break-word text-sm text-foreground">
              <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                {markdownText}
              </ReactMarkdown>
            </article>
          )}

          {status === "ready" && chunks.length > 0 && !asMarkdown && (
            <article className="whitespace-pre-wrap wrap-break-word text-sm leading-7 text-foreground">
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
