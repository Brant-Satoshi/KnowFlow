"use client"

import { isValidElement, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import { AlertCircle, Check, ChevronDown, Copy, Loader2, RefreshCw, Square, Volume2 } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import type { ActiveProgressStage, AssistantProgress } from "@/lib/hooks/use-chat-stream"
import type { RetrievedChunk } from "@/lib/types"
import {
  CitationContext,
  CitationHoverCardBody,
  renderWithCitations,
} from "@/components/inline-citation"
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card"
import { useOpenPreview } from "@/lib/preview-context"
import { cn } from "@/lib/utils"

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children)
  }
  return ""
}

const CodeBlock: Components["pre"] = ({ children, className, node, ...rest }) => {
  void node
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const rawText = extractText(children)
  let language: string | null = null
  if (isValidElement<{ className?: string }>(children)) {
    const cls = children.props.className ?? ""
    const match = /language-([\w-]+)/.exec(cls)
    language = match ? match[1] : null
  }

  const handleCopy = async () => {
    if (!rawText) return
    try {
      await navigator.clipboard.writeText(rawText)
      if (timerRef.current) clearTimeout(timerRef.current)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable in insecure contexts; silently no-op.
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-secondary">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <span className="font-mono">{language ?? ""}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? t.messageActions.copied : t.messageActions.copy}</span>
        </button>
      </div>
      <pre className={cn("overflow-x-auto p-4 text-sm", className)} {...rest}>
        {children}
      </pre>
    </div>
  )
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 text-lg font-semibold leading-7 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 text-base font-semibold leading-7 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 text-sm font-semibold leading-6 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 text-sm font-medium leading-6 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="whitespace-pre-wrap leading-7 not-first:mt-4">{renderWithCitations(children, "p")}</p>
  ),
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{renderWithCitations(children, "li")}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-current">{renderWithCitations(children, "strong")}</strong>
  ),
  a: ({ children, href }) => (
    // Citations are NOT injected here: InlineCitation renders a <button>, and
    // putting an interactive button inside an <a> is invalid HTML and breaks
    // click semantics. Bracketed text inside link text falls through literally.
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline decoration-primary/35 underline-offset-4"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      {renderWithCitations(children, "bq")}
    </blockquote>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className={cn("font-mono text-[13px]", className)}>{children}</code>
    }
    return (
      <code className="rounded-md bg-primary/8 px-1.5 py-0.5 font-mono text-[13px] text-foreground dark:bg-primary/12">
        {children}
      </code>
    )
  },
  pre: CodeBlock,
}

type ChatT = ReturnType<typeof useLanguage>["t"]

const subscribeToTtsSupport = () => () => undefined
const getTtsSupportSnapshot = () => typeof window !== "undefined" && "speechSynthesis" in window
const getTtsSupportServerSnapshot = () => false
let activeSpeechOwner: symbol | null = null

// ProcessTimeline ───────────────────────────────────────────────────────

type DisplayStage = ActiveProgressStage

interface DisplayStep {
  stage: DisplayStage
  label: string
  state: "done" | "active" | "error" | "stopped"
}

function buildDisplaySteps(progress: AssistantProgress, t: ChatT): DisplayStep[] {
  const labels = t.process
  const seen = new Set<DisplayStage>()
  let recalledCount: number | undefined
  let finalCount: number | undefined
  let rerankSkipped = progress.rerankSkipped === true

  for (const step of progress.steps) {
    if (step.stage === "searched") {
      recalledCount = step.meta?.count
      seen.add("searching")
      continue
    }
    if (step.stage === "reranked") {
      finalCount = step.meta?.count
      rerankSkipped = step.meta?.skipped === true || rerankSkipped
      seen.add("reranking")
      continue
    }
    if (
      step.stage === "understanding" ||
      step.stage === "searching" ||
      step.stage === "reranking" ||
      step.stage === "generating"
    ) {
      seen.add(step.stage)
    }
  }

  const order: DisplayStage[] = ["understanding", "searching", "reranking", "generating"]
  const isError = progress.currentStage === "error"
  const isDone = progress.currentStage === "done"
  const isStopped = progress.currentStage === "stopped"

  const steps: DisplayStep[] = []
  for (const stage of order) {
    if (!seen.has(stage)) continue
    let label = ""
    if (stage === "understanding") label = labels.understanding
    else if (stage === "searching") {
      label =
        recalledCount != null
          ? labels.searched.replace("{count}", String(recalledCount))
          : labels.searching
    } else if (stage === "reranking") {
      label =
        rerankSkipped
          ? labels.rerankSkipped
          : finalCount != null
          ? labels.reranked.replace("{count}", String(finalCount))
          : labels.reranking
    } else if (stage === "generating") {
      label = labels.generating
    }

    let state: DisplayStep["state"] = "done"
    if (progress.currentStage === stage && !isDone && !isError && !isStopped) state = "active"
    if (isError && progress.failedStage === stage) state = "error"
    if (isStopped && progress.failedStage === stage) state = "stopped"
    steps.push({ stage, label, state })
  }
  return steps
}

function StageIcon({ state }: { state: DisplayStep["state"] }) {
  if (state === "active") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      </span>
    )
  }
  if (state === "error") {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  }
  if (state === "stopped") {
    return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
  }
  return <Check className="h-3.5 w-3.5 text-primary/80" />
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface ProcessTimelineProps {
  progress: AssistantProgress
  sourceCount: number
  t: ChatT
}

function ProcessTimeline({ progress, sourceCount, t }: ProcessTimelineProps) {
  const isDone = progress.currentStage === "done"
  const isError = progress.currentStage === "error"
  const isStopped = progress.currentStage === "stopped"
  const isFinal = isDone || isError || isStopped
  const [isExpanded, setIsExpanded] = useState(false)
  const [prevIsFinal, setPrevIsFinal] = useState(isFinal)
  if (isFinal !== prevIsFinal) {
    setPrevIsFinal(isFinal)
    if (isFinal) setIsExpanded(false)
  }

  const displaySteps = useMemo(() => buildDisplaySteps(progress, t), [progress, t])
  if (displaySteps.length === 0) return null

  const durationStr =
    progress.completedAt != null
      ? formatDuration(progress.completedAt - progress.startedAt)
      : ""
  const sourcesLabel =
    sourceCount === 1
      ? t.process.sourcesCountSingular.replace("{count}", "1")
      : t.process.sourcesCount.replace("{count}", String(sourceCount))
  const activeStep = displaySteps.find((step) => step.state === "active") ?? displaySteps.at(-1)
  const summary = isError
    ? t.process.errorLabel
    : isStopped
      ? t.process.stoppedLabel
      : isDone
        ? t.process.thoughtFor.replace("{duration}", durationStr)
        : activeStep?.label ?? t.process.processLabel

  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        aria-expanded={false}
        className="group -ml-2 inline-flex min-h-7 max-w-full cursor-pointer items-center gap-1.5 self-start rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        {!isFinal && activeStep ? (
          <StageIcon state="active" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 -rotate-90 transition-transform group-hover:rotate-0" />
        )}
        <span className={cn("truncate font-medium", isError && "text-destructive")}>
          {summary}
        </span>
        {sourceCount > 0 && isDone && (
          <span className="shrink-0 text-muted-foreground/70">· {sourcesLabel}</span>
        )}
      </button>
    )
  }

  return (
    <div className="w-fit max-w-full">
      <button
        type="button"
        onClick={() => setIsExpanded(false)}
        aria-expanded={true}
        className="mb-1.5 inline-flex min-h-6 max-w-full cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className="h-3 w-3 shrink-0" />
        <span className={cn("truncate", isError && "text-destructive")}>
          {isFinal ? t.process.processLabel : summary}
        </span>
      </button>
      <ol className="flex flex-col">
        {displaySteps.map((step, i) => {
          const isLast = i === displaySteps.length - 1
          return (
            <li key={step.stage} className="flex gap-2.5">
              <div className="flex shrink-0 flex-col items-center">
                <div className="flex h-5 w-3.5 items-center justify-center">
                  <StageIcon state={step.state} />
                </div>
                {!isLast && <div className="w-px flex-1 bg-border" />}
              </div>
              <div
                className={cn(
                  "text-[12.5px] leading-5",
                  !isLast && "pb-2",
                  step.state === "active" && "text-foreground",
                  step.state === "error" && "text-destructive",
                  step.state === "stopped" && "text-muted-foreground",
                  step.state === "done" && "text-muted-foreground",
                )}
              >
                {step.label}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// SourceBadge / SourcesList ────────────────────────────────────────────

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

function SourcesList({
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

// MessageActions ───────────────────────────────────────────────────────

interface MessageActionsProps {
  text: string
  onRegenerate?: () => void
  regenerateDisabled?: boolean
  t: ChatT
}

function MessageActions({
  text,
  onRegenerate,
  regenerateDisabled,
  t,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const speechOwnerRef = useRef(Symbol("message-speech"))
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const ttsSupported = useSyncExternalStore(
    subscribeToTtsSupport,
    getTtsSupportSnapshot,
    getTtsSupportServerSnapshot,
  )

  useEffect(() => {
    const speechOwner = speechOwnerRef.current
    return () => {
      if (activeSpeechOwner !== speechOwner) return
      activeSpeechOwner = null
      currentUtteranceRef.current = null
      if ("speechSynthesis" in window) window.speechSynthesis.cancel()
    }
  }, [])

  const handleCopy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable in insecure contexts; silently no-op.
    }
  }

  const handleSpeak = () => {
    const synth = window.speechSynthesis
    if (speaking) {
      activeSpeechOwner = null
      currentUtteranceRef.current = null
      synth.cancel()
      setSpeaking(false)
      return
    }
    if (!text) return
    // Strip citation markers and light markdown so they aren't read aloud.
    const spoken = text
      .replace(/\[\d+\]/g, "")
      .replace(/[#*_`~>]/g, "")
      .trim()
    if (!spoken) return
    const utterance = new SpeechSynthesisUtterance(spoken)
    utterance.onend = () => {
      if (currentUtteranceRef.current === utterance) currentUtteranceRef.current = null
      if (activeSpeechOwner === speechOwnerRef.current) activeSpeechOwner = null
      setSpeaking(false)
    }
    utterance.onerror = utterance.onend
    synth.cancel()
    activeSpeechOwner = speechOwnerRef.current
    currentUtteranceRef.current = utterance
    synth.speak(utterance)
    setSpeaking(true)
  }

  return (
    <div className="-ml-2 flex items-center gap-1 text-muted-foreground">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? t.messageActions.copied : t.messageActions.copy}
        title={copied ? t.messageActions.copied : t.messageActions.copy}
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {ttsSupported && (
        <button
          type="button"
          onClick={handleSpeak}
          aria-label={speaking ? t.messageActions.stop : t.messageActions.say}
          title={speaking ? t.messageActions.stop : t.messageActions.say}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {speaking ? <Square className="h-3.5 w-3.5 text-primary" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerateDisabled}
          aria-label={t.messageActions.regenerate}
          title={t.messageActions.regenerate}
          className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// AssistantMessageCard ─────────────────────────────────────────────────

interface AssistantMessageCardProps {
  messageId: string
  text: string
  isStreaming: boolean
  isLoading: boolean
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
  isLoading,
  citations,
  retrievedChunks,
  progress,
  onRegenerate,
  regenerateDisabled,
}: AssistantMessageCardProps) {
  const { t } = useLanguage()

  const hasBody = text.length > 0
  const showLoadingDots = isLoading && !hasBody && !progress
  const isFinal =
    progress?.currentStage === "done" ||
    progress?.currentStage === "error" ||
    progress?.currentStage === "stopped"

  const citationLookup = useMemo(
    () => new Map(retrievedChunks.map((c) => [c.index, c])),
    [retrievedChunks],
  )

  return (
    <div className="flex items-start gap-3">
      <div className="w-full min-w-0 space-y-2">
        {progress && <ProcessTimeline progress={progress} sourceCount={citations.length} t={t} />}

        <div className="text-foreground" data-testid="assistant-message">
          {showLoadingDots ? (
            <div
              className="flex h-7 items-center gap-1.5"
              role="status"
              aria-label={t.process.generatingAriaLabel}
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <span
                  key={i}
                  className="loading-dot-breathe h-2 w-2 rounded-full bg-primary/60"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
            </div>
          ) : (
            <CitationContext.Provider value={citationLookup}>
              <div className="text-sm text-current">
                {isStreaming ? (
                  <div className="streaming-active wrap-break-word leading-7">
                    <ReactMarkdown components={markdownComponents}>
                      {text}
                    </ReactMarkdown>
                  </div>
                ) : hasBody ? (
                  <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
                ) : isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </CitationContext.Provider>
          )}
        </div>

        <SourcesList citations={citations} messageId={messageId} t={t} />

        {hasBody && (isFinal || !progress) && !isStreaming && (
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
