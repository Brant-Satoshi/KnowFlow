"use client"

import type { useLanguage } from "@/lib/i18n/LanguageContext"
import type { RetrievedChunk } from "@/lib/types"
import { CitationHoverCardBody } from "@/components/chat/inline-citation"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import { useOpenPreview } from "@/lib/preview-context"
import { cn } from "@/lib/utils"

type ChatT = ReturnType<typeof useLanguage>["t"]

function SourceBadge({ chunk, t }: { chunk: RetrievedChunk; t: ChatT }) {
  const scoreText = chunk.score != null ? chunk.score.toFixed(2) : null
  const openPreview = useOpenPreview()
  return (
    <HoverCard openDelay={100} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="citation"
          onClick={() =>
            openPreview?.({ fileId: chunk.fileId, fileName: chunk.fileName, chunkId: chunk.chunkId })
          }
          disabled={openPreview == null}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-border bg-secondary px-2.5 py-1 font-mono text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground disabled:cursor-default"
        >
          <span className="text-[9.5px] text-muted-foreground/70">[{chunk.index}]</span>
          <span className="max-w-[18rem] truncate">{chunk.fileName}</span>
          {chunk.page != null && (
            <span className="text-[9.5px] text-muted-foreground/60">p.{chunk.page}</span>
          )}
          {scoreText && (
            <span
              className={cn(
                "text-[9.5px]",
                chunk.scoreType === "rerank"
                  ? "text-primary/70"
                  : "text-muted-foreground/60",
              )}
            >
              · {scoreText}
            </span>
          )}
        </button>
      </HoverCardTrigger>
      <CitationHoverCardBody chunk={chunk} t={t} />
    </HoverCard>
  )
}

export function SourcesList({
  citations,
  messageId,
  t,
}: {
  citations: RetrievedChunk[]
  messageId: string
  t: ChatT
}) {
  if (citations.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {t.sourcesLabel}
      </span>
      {citations.map((chunk) => (
        <SourceBadge key={`${messageId}-${chunk.index}`} chunk={chunk} t={t} />
      ))}
    </div>
  )
}
