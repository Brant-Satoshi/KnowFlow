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

  return (
    <div className="px-3 pb-3 pt-2 sm:px-5 sm:pb-4 sm:pt-3">
      <div className="mx-auto max-w-5xl">
        {/* Input container */}
        <div className={cn(
          "rounded-[14px] border bg-secondary p-2 transition-all sm:p-3",
          "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15",
          "border-border"
        )}>
          <div className="relative flex items-end gap-2 rounded-[11px] border border-border bg-card px-2 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasKnowledge ? t.placeholderWithKnowledge : t.placeholderNoKnowledge}
              rows={1}
              disabled={isDisabled}
              className="h-auto max-h-[30svh] min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-[6px] text-[13.5px] leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
            />

            {isLoading ? (
              <button
                onClick={onStop}
                className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-border bg-secondary px-3.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-secondary/80"
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
                  "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-all disabled:cursor-not-allowed",
                  canSend
                    ? "bg-primary text-primary-foreground shadow-[0_8px_24px_-8px_hsl(var(--primary)/.5)] hover:opacity-90"
                    : "bg-secondary text-muted-foreground"
                )}
                aria-label={t.send}
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Footer row */}
          <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[10.5px] text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">{helperText}</span>
            <div className="flex shrink-0 items-center gap-2">
              {sourceCount > 0 && (
                <span className="inline-flex items-center rounded-[6px] border border-border bg-card px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {sourceCount} {t.sourceCountLabel}
                </span>
              )}
              <span className="hidden sm:inline">{t.inputShortcutHint}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
