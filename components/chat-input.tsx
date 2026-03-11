"use client"

import React from "react"

import { useRef, useEffect } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"

interface ChatInputProps {
  input: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  hasKnowledge: boolean
}

export function ChatInput({
  input,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  hasKnowledge,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`
    }
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="px-8 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end rounded-2xl border border-border bg-card transition-colors focus-within:border-primary/50 shadow-[0_4px_4px_rgba(0,0,0,0.1)]">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              hasKnowledge
                ? "Ask a question about your documents..."
                : "Add documents first, then ask questions..."
            }
            rows={1}
            className="h-auto w-auto max-h-[30svh] min-h-[56px] flex-1 resize-none border-0 bg-transparent px-4 py-4 text-base md:text-base leading-6 text-foreground shadow-none placeholder:text-base placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              onClick={onStop}
              className="m-1.5 flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-secondary px-3 text-xs font-medium text-foreground transition-all hover:bg-secondary/80"
              aria-label="Stop generating"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!input.trim()}
              className={cn(
                "mx-1.5 mb-3 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-all",
                input.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground"
              )}
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
          Answers are generated based on your uploaded knowledge base.
        </p>
      </div>
    </div>
  )
}
