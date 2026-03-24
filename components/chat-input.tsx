"use client"

import React, { useEffect, useRef } from "react"
import { ArrowUp, Square } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  input: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  hasKnowledge: boolean
  isPreparingKnowledge: boolean
  sourceCount: number
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  hasKnowledge,
  isPreparingKnowledge,
  sourceCount,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useLanguage()

  useEffect(() => {
    if (!textareaRef.current) return

    textareaRef.current.style.height = "auto"
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`
  }, [input])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  const isDisabled = isLoading || !hasKnowledge
  const helperText = hasKnowledge
    ? t.inputReadyHint
    : isPreparingKnowledge
      ? t.inputPreparingHint
      : t.inputBlockedHint

  return (
    <div className="px-4 pb-4 pt-3 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[1rem] border border-white/60 bg-white/84 p-3 shadow-[0_30px_80px_-48px_rgba(19,31,56,0.38)] backdrop-blur-xl dark:border-white/10 dark:bg-[#10161d]/88 dark:shadow-[0_30px_80px_-48px_rgba(0,0,0,0.9)]">
          <div className="relative flex items-end gap-3 rounded-[0.9rem] border border-black/8 bg-black/[0.025] px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasKnowledge ? t.placeholderWithKnowledge : t.placeholderNoKnowledge}
              rows={1}
              disabled={isDisabled}
              className="h-auto max-h-[30svh] min-h-[60px] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-base leading-7 text-foreground shadow-none placeholder:text-base placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60"
            />

            {isLoading ? (
              <button
                onClick={onStop}
                className="mb-1 flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-black/10 bg-black/[0.04] px-4 text-sm font-medium text-foreground transition-colors hover:bg-black/[0.08] dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                aria-label={t.stop}
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                {t.stop}
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!input.trim() || !hasKnowledge}
                className={cn(
                  "mb-1 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-all disabled:cursor-not-allowed",
                  input.trim() && hasKnowledge
                    ? "bg-[#101828] text-white shadow-[0_18px_40px_-22px_rgba(15,23,42,0.85)] hover:bg-[#1d2939] dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    : "bg-black/[0.06] text-muted-foreground dark:bg-white/[0.08]"
                )}
                aria-label={t.send}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1 px-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{helperText}</span>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              {sourceCount > 0 && (
                <span className="inline-flex items-center rounded-lg border border-black/8 bg-black/[0.03] px-2.5 py-1 text-[11px] text-muted-foreground dark:border-white/10 dark:bg-white/[0.05]">
                  {sourceCount} {t.sourceCountLabel}
                </span>
              )}
              <span>{t.inputShortcutHint}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
