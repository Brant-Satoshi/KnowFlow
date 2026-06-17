"use client"

import { useCallback, useRef } from "react"
import { Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  hasKnowledge: boolean
  isPreparingKnowledge?: boolean
  onSuggestionClick: (text: string) => void
  onUpload?: (file: File) => void
}

export function EmptyState({
  hasKnowledge,
  isPreparingKnowledge = false,
  onSuggestionClick,
  onUpload,
}: EmptyStateProps) {
  const { t, language } = useLanguage()
  const isPreparing = isPreparingKnowledge && !hasKnowledge
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file && onUpload) onUpload(file)
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [onUpload]
  )

  const showUploadCta = !hasKnowledge && !isPreparing && Boolean(onUpload)

  const suggestions = [t.suggestions.summarize, t.suggestions.topics, t.suggestions.insights]
  const steps = [t.uploadFile, t.autoParseFile, t.ask]

  const title = isPreparing ? t.workspacePreparing : t.emptyStateTitle
  const description = isPreparing
    ? t.inputPreparingHint
    : hasKnowledge
      ? t.emptyStateWithKnowledgeDesc
      : t.emptyStateDesc

  return (
    <div className="flex min-h-full items-center px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* Greeting glyph */}
        {isPreparing ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-amber-200/60 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div aria-hidden className="text-5xl leading-none">👋</div>
        )}

        {/* Heading + description */}
        <h2
          className={cn(
            "mt-5 text-[2rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2.25rem]",
            language === "zh"
              ? "[font-family:var(--font-home-sans)]"
              : "[font-family:var(--font-home-display)]"
          )}
        >
          {title}
        </h2>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.8] text-muted-foreground">
          {description}
        </p>

        {/* Action area */}
        {hasKnowledge ? (
          <>
            <h3 className="mt-8 text-[14px] font-semibold text-foreground">
              {t.emptyStatePrompt}
            </h3>
            <div className="mt-4 flex flex-col items-start gap-3">
              {suggestions.map((text) => (
                <button
                  key={text}
                  onClick={() => onSuggestionClick(text)}
                  className="cursor-pointer rounded-full border border-border bg-transparent px-5 py-2.5 text-left text-[14px] text-foreground transition-colors hover:border-primary/30 hover:bg-secondary"
                >
                  {text}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-8 flex max-w-md flex-col gap-2.5">
            {steps.map((step, i) => (
              <div
                key={step}
                className={cn(
                  "flex items-center gap-3 rounded-[11px] border px-3.5 py-2.5",
                  isPreparing
                    ? "border-amber-200/50 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20"
                    : "border-border bg-secondary"
                )}
              >
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] font-mono text-[11px] font-semibold text-foreground",
                    isPreparing ? "bg-white/70 dark:bg-white/6" : "bg-card"
                  )}
                >
                  0{i + 1}
                </div>
                <span className="text-[12.5px] text-foreground">{step}</span>
              </div>
            ))}
          </div>
        )}

        {showUploadCta && (
          <div className="mt-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.pdf,.doc,.docx"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-xl px-5"
            >
              <Upload className="h-4 w-4" />
              {t.uploadFile}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
