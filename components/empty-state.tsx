"use client"

import { useCallback, useRef } from "react"
import { FileText, Loader2, MessageSquare, Sparkles, Upload, Zap } from "lucide-react"
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

  const suggestions = [
    { icon: FileText,     text: t.suggestions.summarize, description: t.suggestions.summarizeDesc },
    { icon: MessageSquare,text: t.suggestions.topics,    description: t.suggestions.topicsDesc },
    { icon: Zap,          text: t.suggestions.insights,  description: t.suggestions.insightsDesc },
  ]

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        {/* Icon + heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[13px] border",
            isPreparing
              ? "border-amber-200/60 bg-amber-50 text-amber-600 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
              : "border-primary/25 bg-primary/10 text-primary"
          )}>
            {isPreparing
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Sparkles className="h-4 w-4" />}
          </div>

          <div className="max-w-[30rem]">
            <h2 className={cn(
              "text-[1.75rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2rem]",
              language === "zh"
                ? "[font-family:var(--font-home-sans)]"
                : "[font-family:var(--font-home-display)]"
            )}>
              {isPreparing ? t.workspacePreparing : t.emptyStateTitle}
            </h2>
            <p className="mt-2.5 text-[13.5px] leading-[1.7] text-muted-foreground">
              {isPreparing
                ? t.inputPreparingHint
                : hasKnowledge
                  ? t.emptyStateWithKnowledgeDesc
                  : t.emptyStateDesc}
            </p>
          </div>
        </div>

        {/* Info / status card */}
        <div className="mt-6 w-full">
          {isPreparing ? (
            <div className="rounded-[13px] border border-amber-200/60 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-white/70 text-amber-600 dark:bg-white/6 dark:text-amber-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-foreground">{t.workspacePreparing}</p>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t.inputPreparingHint}</p>
                </div>
              </div>
            </div>
          ) : hasKnowledge ? (
            <div className="rounded-[13px] border border-border bg-secondary px-4 py-3">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {t.suggestions.title}
              </p>
              <p className="mt-1 text-[12.5px] leading-6 text-muted-foreground">{t.chatInputHint}</p>
            </div>
          ) : (
            <div className="rounded-[13px] border border-border bg-secondary p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-card text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-foreground">{t.emptyStateAddDocsHint}</p>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t.panelEmptyDesc}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Steps / suggestions */}
        {isPreparing ? (
          <div className="mt-4 grid w-full gap-2.5 sm:grid-cols-3">
            {[t.uploadFile, t.autoParseFile, t.ask].map((step, i) => (
              <div key={step} className="flex items-center gap-3 rounded-[11px] border border-amber-200/50 bg-amber-50/60 px-3.5 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-white/70 font-mono text-[11px] font-semibold text-foreground dark:bg-white/6">
                  0{i + 1}
                </div>
                <span className="text-[12.5px] text-foreground">{step}</span>
              </div>
            ))}
          </div>
        ) : hasKnowledge ? (
          <div className="mt-4 grid w-full gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {suggestions.map(s => (
              <button
                key={s.text}
                onClick={() => onSuggestionClick(s.text)}
                className="group cursor-pointer rounded-[13px] border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-secondary"
              >
                <div className="flex items-start gap-3 xl:flex-col xl:gap-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-secondary text-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <s.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{s.text}</p>
                    <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">{s.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 grid w-full gap-2.5 sm:grid-cols-3">
            {[t.uploadFile, t.autoParseFile, t.ask].map((step, i) => (
              <div key={step} className="flex items-center gap-3 rounded-[11px] border border-border bg-secondary px-3.5 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-card font-mono text-[11px] font-semibold text-foreground">
                  0{i + 1}
                </div>
                <span className="text-[12.5px] text-foreground">{step}</span>
              </div>
            ))}
          </div>
        )}

        {showUploadCta && (
          <div className="mt-5 flex justify-center">
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
