"use client"

import { Children, cloneElement, createContext, isValidElement, useContext, type ReactNode } from "react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useOpenPreview } from "@/lib/preview-context"
import type { RetrievedChunk } from "@/lib/types"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

type ChatT = ReturnType<typeof useLanguage>["t"]

export const CitationContext = createContext<Map<number, RetrievedChunk> | null>(null)

// Keep this regex in sync with parseUsedIndices in lib/hooks/use-chat-stream.ts:115.
const CITATION_PATTERN = /(?<!\w)\[(\d+)\]/g

const SUPER_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"]

function toSuperscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUPER_DIGITS[Number(d)] ?? d)
    .join("")
}

export function CitationHoverCardBody({ chunk, t }: { chunk: RetrievedChunk; t: ChatT }) {
  const scoreText = chunk.score != null ? chunk.score.toFixed(2) : null
  const scoreTypeLabel =
    chunk.scoreType === "rerank"
      ? t.sourceScore.rerank
      : chunk.scoreType === "vector"
      ? t.sourceScore.vector
      : chunk.scoreType === "keyword"
      ? t.sourceScore.keyword
      : null
  return (
    <HoverCardContent
      className="w-80 rounded-[10px] text-xs leading-6 text-muted-foreground"
      side="top"
    >
      <div className="mb-2 flex items-center gap-1.5 border-b border-border pb-2">
        <span className="truncate font-medium text-foreground">{chunk.fileName}</span>
        {chunk.page != null && (
          <span className="shrink-0 text-[10px] text-muted-foreground/60">p.{chunk.page}</span>
        )}
      </div>
      {scoreText && scoreTypeLabel && (
        <div className="mb-2 text-[10px] text-muted-foreground/70">
          {scoreTypeLabel} · {scoreText}
        </div>
      )}
      <p className="line-clamp-6">{chunk.quote}</p>
    </HoverCardContent>
  )
}

export function InlineCitation({ index }: { index: number }) {
  const lookup = useContext(CitationContext)
  const openPreview = useOpenPreview()
  const { t } = useLanguage()
  const chunk = lookup?.get(index)

  if (!chunk) return <>[{index}]</>

  return (
    <HoverCard openDelay={100} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="inline-citation"
          aria-label={`${t.sourcesLabel} ${index} — ${chunk.fileName}`}
          onClick={() =>
            openPreview?.({ fileId: chunk.fileId, fileName: chunk.fileName, chunkId: chunk.chunkId })
          }
          disabled={openPreview == null}
          className={cn(
            "cursor-pointer align-super font-mono text-[10px] font-medium",
            "text-primary/80 hover:text-primary transition-colors",
            "px-0.5 select-none disabled:cursor-default",
          )}
        >
          {toSuperscript(index)}
        </button>
      </HoverCardTrigger>
      <CitationHoverCardBody chunk={chunk} t={t} />
    </HoverCard>
  )
}

export function renderWithCitations(children: ReactNode, keyPrefix: string): ReactNode {
  if (children == null || typeof children === "boolean") return children
  if (typeof children === "number") return children

  if (typeof children === "string") {
    if (!CITATION_PATTERN.test(children)) return children
    CITATION_PATTERN.lastIndex = 0
    const parts: ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let i = 0
    while ((match = CITATION_PATTERN.exec(children)) !== null) {
      if (match.index > lastIndex) {
        parts.push(children.slice(lastIndex, match.index))
      }
      const idx = Number(match[1])
      parts.push(<InlineCitation key={`${keyPrefix}-cite-${i++}-${match.index}`} index={idx} />)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < children.length) {
      parts.push(children.slice(lastIndex))
    }
    return parts
  }

  if (Array.isArray(children)) {
    return Children.map(children, (child, i) => renderWithCitations(child, `${keyPrefix}.${i}`))
  }

  if (isValidElement<{ children?: ReactNode }>(children)) {
    // Skip subtrees where injecting an interactive <button> would be invalid
    // HTML (button-in-button via <a>) or where bracket text is meant to be
    // literal (code blocks).
    if (children.type === "code" || children.type === "pre" || children.type === "a") {
      return children
    }
    const next = renderWithCitations(children.props.children, keyPrefix)
    return cloneElement(children, { key: children.key ?? keyPrefix }, next)
  }

  return children
}
