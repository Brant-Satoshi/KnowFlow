"use client"

import { FileText, MessageSquare, Sparkles, Zap } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"

interface EmptyStateProps {
  hasKnowledge: boolean
  onSuggestionClick: (text: string) => void
}

export function EmptyState({
  hasKnowledge,
  onSuggestionClick,
}: EmptyStateProps) {
  const { t, language } = useLanguage()

  const suggestions = [
    {
      icon: FileText,
      text: t.suggestions.summarize,
      description: t.suggestions.summarizeDesc,
    },
    {
      icon: MessageSquare,
      text: t.suggestions.topics,
      description: t.suggestions.topicsDesc,
    },
    {
      icon: Zap,
      text: t.suggestions.insights,
      description: t.suggestions.insightsDesc,
    },
  ]

  return (
    <div className="flex min-h-full items-start justify-center px-4 py-4 sm:px-6 sm:py-5">
      <div className="w-full max-w-3xl">
        <div className="rounded-[1.25rem] sm:p-4">
          <div className="flex flex-col items-center gap-3 text-center sm:gap-4">
            <div className="max-w-[32rem]">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfcfaa] bg-[#fbf2d9] text-[#956712] dark:border-[#5a4820] dark:bg-[#2b2519] dark:text-[#f0c669]">
                <Sparkles className="h-4 w-4" />
              </div>

              <h2
                className={`mt-3 text-3xl font-semibold text-foreground sm:mt-4 sm:text-4xl ${
                  language === "zh"
                    ? "[font-family:var(--font-home-sans)] tracking-[-0.03em]"
                    : "[font-family:var(--font-home-display)] tracking-[-0.05em]"
                }`}
              >
                {t.emptyStateTitle}
              </h2>
              <p className="mt-3 max-w-[32rem] text-sm leading-7 text-muted-foreground sm:text-base">
                {hasKnowledge ? t.emptyStateWithKnowledgeDesc : t.emptyStateDesc}
              </p>
            </div>

            <div className="w-full max-w-3xl">
              {hasKnowledge ? (
                <div className="rounded-[1rem] border border-black/8 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t.suggestions.title}</p>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t.chatInputHint}</p>
                </div>
              ) : (
                <div className="rounded-[1rem] border border-[#c7d7eb] bg-[#ebf3fb] p-4 dark:border-[#2c4a67] dark:bg-[#12202d]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-[#27517d] dark:bg-white/8 dark:text-[#9ecdf6]">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-left text-sm font-medium text-foreground">{t.emptyStateAddDocsHint}</p>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t.panelEmptyDesc}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {hasKnowledge ? (
            <div className="mx-auto mt-4 grid w-full max-w-3xl gap-3 sm:mt-5 md:grid-cols-2 xl:grid-cols-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.text}
                  onClick={() => onSuggestionClick(suggestion.text)}
                  className="group h-full cursor-pointer rounded-[1rem] border border-black/8 bg-white/60 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
                >
                  <div className="flex items-start gap-3 xl:flex-col xl:gap-4">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-foreground dark:bg-white/[0.07]">
                      <suggestion.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{suggestion.text}</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{suggestion.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-4 grid w-full max-w-3xl gap-3 sm:mt-5 md:grid-cols-3">
              {[t.uploadFile, t.parseFile, t.ask].map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 rounded-[1rem] border border-black/8 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/6 text-sm font-semibold text-foreground dark:bg-white/8">
                    0{index + 1}
                  </div>
                  <span className="text-sm text-foreground">{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
