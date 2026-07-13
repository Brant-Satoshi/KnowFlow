"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Check, ChevronDown } from "lucide-react"
import type { useLanguage } from "@/lib/i18n/LanguageContext"
import type { ActiveProgressStage, AssistantProgress } from "@/lib/hooks/use-chat-stream"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

type ChatT = ReturnType<typeof useLanguage>["t"]

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

interface ProcessTimelineProps {
  progress: AssistantProgress
  sourceCount: number
  t: ChatT
}

export function ProcessTimeline({ progress, sourceCount, t }: ProcessTimelineProps) {
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
                  "text-[12.5px]/5",
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
