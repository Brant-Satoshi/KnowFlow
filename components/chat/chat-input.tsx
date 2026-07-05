"use client"

import React, { useEffect, useRef } from "react"
import { ArrowUp, Square } from "lucide-react"
import { ModelPicker } from "@/components/chat/model-picker"
import { RetrievalFilterControl } from "@/components/chat/retrieval-filter"
import { Textarea } from "@/components/ui/textarea"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { cn } from "@/lib/utils"
import type { FileListItem, RetrievalFilter } from "@/lib/types"

interface ChatInputProps {
  input: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  hasKnowledge: boolean
  isPreparingKnowledge: boolean
  selectedModel: string
  onModelChange: (modelId: string) => void
  isModelDisabled?: boolean
  files: FileListItem[]
  retrievalFilter: RetrievalFilter
  onRetrievalFilterChange: (filter: RetrievalFilter) => void
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  hasKnowledge,
  isPreparingKnowledge,
  selectedModel,
  onModelChange,
  isModelDisabled,
  files,
  retrievalFilter,
  onRetrievalFilterChange,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useLanguage()

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "auto"
    if (input) {
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`
    }
  }, [input])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (canSend) onSubmit()
    }
  }

  const isDisabled = isLoading
  const helperText = hasKnowledge
    ? t.inputReadyHint
    : isPreparingKnowledge
      ? t.inputPreparingHint
      : t.inputBlockedHint

  const canSend = input.trim() && hasKnowledge
  const needsUpload = !!input.trim() && !hasKnowledge && !isPreparingKnowledge

  return (
    <div className="px-3 pb-3 sm:px-5 sm:pb-4">
      <div className="mx-auto max-w-3xl w-full">
        <div className={cn(
          "relative flex flex-col gap-2 rounded-3xl border border-border bg-secondary px-3 py-2 transition-colors sm:px-4 sm:py-2.5",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15"
        )}>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasKnowledge ? t.placeholderWithKnowledge : t.placeholderNoKnowledge}
            rows={1}
            disabled={isDisabled}
            className="h-auto max-h-[30svh] min-h-10 resize-none border-0 bg-transparent px-1 py-1.5 text-[13.5px] leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <ModelPicker
                value={selectedModel}
                onChange={onModelChange}
                disabled={isModelDisabled}
                t={t}
                triggerClassName="h-8 w-[160px] cursor-pointer rounded-full border-border/70 bg-background/45 px-3 text-[12px] shadow-none focus:ring-1 focus:ring-primary/35 focus:ring-offset-0 sm:w-[180px]"
              />
              <RetrievalFilterControl
                files={files.filter(f => f.status === "indexed")}
                value={retrievalFilter}
                onChange={onRetrievalFilterChange}
                disabled={isModelDisabled}
                labels={{
                  button: t.filterButtonLabel,
                  aria: t.filterAriaLabel,
                  filesLabel: t.filterFilesLabel,
                  noFiles: t.filterNoFiles,
                  typesLabel: t.filterTypesLabel,
                  typePdf: t.filterTypePdf,
                  typeMarkdown: t.filterTypeMarkdown,
                  typeWord: t.filterTypeWord,
                  typeText: t.filterTypeText,
                  titleLabel: t.filterTitleLabel,
                  titlePlaceholder: t.filterTitlePlaceholder,
                  clear: t.filterClear,
                }}
                triggerClassName="h-8 shrink-0 cursor-pointer gap-1 rounded-full border-border/70 bg-background/45 px-3 text-[12px] shadow-none"
              />
            </div>

            {isLoading ? (
              <button
                onClick={onStop}
                className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-secondary px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-secondary/80"
                aria-label={t.stop}
              >
                <Square className="h-3 w-3 fill-current" />
                {t.stop}
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!canSend}
                className={cn(
                  "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all disabled:cursor-not-allowed",
                  canSend
                    ? "bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/.5)] hover:opacity-90"
                    : "bg-foreground/15 text-foreground/60"
                )}
                aria-label={t.send}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Footer caption */}
        <div className="mt-2 px-1 text-center text-[10.5px] text-muted-foreground">
          <span
            className={cn(
              "transition-colors",
              needsUpload && "font-medium text-amber-600 dark:text-amber-400"
            )}
          >
            {helperText}
          </span>
        </div>
      </div>
    </div>
  )
}
