"use client"

import { useMemo } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { AlertCircle } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import type { AssistantProgress } from "@/lib/hooks/use-chat-stream"
import type { RetrievedChunk } from "@/lib/types"
import { CitationContext, renderWithCitations } from "@/components/chat/inline-citation"
import { baseMarkdownComponents } from "@/components/markdown/base-components"
import { CodeBlock, StreamingContext } from "@/components/markdown/code-block"
import { MessageActions } from "@/components/chat/message-actions"
import { ProcessTimeline } from "@/components/chat/process-timeline"
import { SourcesList } from "@/components/chat/sources-list"

// Text-bearing nodes are overridden to inject inline citations; `a` stays on
// the base renderer on purpose (buttons inside links are invalid HTML).
const markdownComponents: Components = {
  ...baseMarkdownComponents,
  p: ({ children }) => (
    <p className="whitespace-pre-wrap leading-7 not-first:mt-4">{renderWithCitations(children, "p")}</p>
  ),
  li: ({ children }) => <li className="leading-7">{renderWithCitations(children, "li")}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-current">{renderWithCitations(children, "strong")}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      {renderWithCitations(children, "bq")}
    </blockquote>
  ),
  th: ({ children }) => (
    <th className="border-r border-border px-3 py-2 font-semibold text-foreground last:border-r-0">
      {renderWithCitations(children, "th")}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-r border-border px-3 py-2 align-top leading-6 last:border-r-0">
      {renderWithCitations(children, "td")}
    </td>
  ),
  pre: CodeBlock,
}

function ErrorTag({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="inline-flex items-start gap-1.5 rounded-[7px] border border-destructive/20 bg-destructive/10 px-2.5 py-1.5 text-[12.5px] font-medium text-destructive"
    >
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="wrap-break-word">{message}</span>
    </div>
  )
}

interface AssistantMessageCardProps {
  messageId: string
  text: string
  isStreaming: boolean
  citations: RetrievedChunk[]
  retrievedChunks: RetrievedChunk[]
  progress?: AssistantProgress
  onRegenerate?: (messageId: string) => void
  regenerateDisabled?: boolean
}

export function AssistantMessageCard({
  messageId,
  text,
  isStreaming,
  citations,
  retrievedChunks,
  progress,
  onRegenerate,
  regenerateDisabled,
}: AssistantMessageCardProps) {
  const { t } = useLanguage()

  const hasBody = text.length > 0
  const isFinal =
    progress?.currentStage === "done" ||
    progress?.currentStage === "error" ||
    progress?.currentStage === "stopped"
  // A turn interrupted (or errored) before any token arrives has no body, but
  // the user still needs a way to retry it.
  const isStoppedOrError =
    progress?.currentStage === "stopped" || progress?.currentStage === "error"
  // The LLM can finish normally without emitting a single token; show a
  // placeholder instead of silently swallowing the turn.
  const isEmptyDone = !hasBody && progress?.currentStage === "done"

  const citationLookup = useMemo(
    () => new Map(retrievedChunks.map((c) => [c.index, c])),
    [retrievedChunks],
  )

  return (
    <div className="flex items-start gap-3">
      <div className="w-full min-w-0 space-y-2">
        {progress && <ProcessTimeline progress={progress} sourceCount={citations.length} t={t} />}

        <div className="text-foreground" data-testid="assistant-message">
          <CitationContext.Provider value={citationLookup}>
            <StreamingContext.Provider value={isStreaming}>
              <div className="text-base text-current">
                {isStreaming ? (
                  <div className="streaming-active wrap-break-word leading-7">
                    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                      {text}
                    </ReactMarkdown>
                  </div>
                ) : hasBody ? (
                  <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                    {text}
                  </ReactMarkdown>
                ) : isEmptyDone ? (
                  <p className="italic text-muted-foreground">{t.process.emptyAnswer}</p>
                ) : null}
              </div>
            </StreamingContext.Provider>
          </CitationContext.Provider>
        </div>

        {progress?.currentStage === "error" && progress.errorMessage && (
          <ErrorTag message={progress.errorMessage} />
        )}

        <SourcesList citations={citations} messageId={messageId} t={t} />

        {(hasBody || isStoppedOrError || isEmptyDone) && (isFinal || !progress) && !isStreaming && (
          <MessageActions
            text={text}
            onRegenerate={onRegenerate ? () => onRegenerate(messageId) : undefined}
            regenerateDisabled={regenerateDisabled}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
