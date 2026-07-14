"use client"

import { memo, useContext, useMemo, type ReactNode } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { AlertCircle } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import type { AssistantProgress } from "@/lib/hooks/use-chat-stream"
import type { RetrievedChunk } from "@/lib/types"

type ChatT = ReturnType<typeof useLanguage>["t"]
import { CitationContext, renderWithCitations } from "@/components/chat/inline-citation"
import { baseMarkdownComponents } from "@/components/markdown/base-components"
import { CodeBlock, StreamingContext } from "@/components/markdown/code-block"
import { fadeStreamingText } from "@/components/markdown/stream-fade"
import { MessageActions } from "@/components/chat/message-actions"
import { ProcessTimeline } from "@/components/chat/process-timeline"
import { SourcesList } from "@/components/chat/sources-list"

// Citation-processed prose that additionally fades in newly streamed words
// while the answer is streaming; renders plain once the stream completes.
function StreamedProse({ part, children }: { part: string; children?: ReactNode }) {
  const isStreaming = useContext(StreamingContext)
  const content = renderWithCitations(children, part)
  return <>{isStreaming ? fadeStreamingText(content, part) : content}</>
}

// Text-bearing nodes are overridden to inject inline citations; `a` stays on
// the base renderer on purpose (buttons inside links are invalid HTML).
const markdownComponents: Components = {
  ...baseMarkdownComponents,
  p: ({ children }) => (
    <p className="whitespace-pre-wrap leading-7 not-first:mt-4"><StreamedProse part="p">{children}</StreamedProse></p>
  ),
  li: ({ children }) => <li className="leading-7"><StreamedProse part="li">{children}</StreamedProse></li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-current"><StreamedProse part="strong">{children}</StreamedProse></strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      <StreamedProse part="bq">{children}</StreamedProse>
    </blockquote>
  ),
  th: ({ children }) => (
    <th className="border-r border-border px-3 py-2 font-semibold text-foreground last:border-r-0">
      <StreamedProse part="th">{children}</StreamedProse>
    </th>
  ),
  td: ({ children }) => (
    <td className="border-r border-border px-3 py-2 align-top leading-6 last:border-r-0">
      <StreamedProse part="td">{children}</StreamedProse>
    </td>
  ),
  pre: CodeBlock,
}

function ErrorTag({ progress, t }: { progress: AssistantProgress; t: ChatT }) {
  // Prefer the localized copy for the server's error code. `errorMessage` is a
  // raw upstream string (often English, often jargon) — a last resort, not the
  // first thing to show someone.
  const message = progress.errorCode
    ? t.errors[progress.errorCode]
    : progress.errorMessage || t.commonError

  return (
    <div
      role="alert"
      data-testid="chat-error"
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

// Memoized so per-frame streaming flushes re-render only the streaming card,
// not every markdown-parsed message in the conversation. Callers must keep
// props referentially stable (see ChatMessages / useChatStream).
export const AssistantMessageCard = memo(function AssistantMessageCard({
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
                  <div className="wrap-break-word leading-7">
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

        {progress?.currentStage === "error" && <ErrorTag progress={progress} t={t} />}

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
})
