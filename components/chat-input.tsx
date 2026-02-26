"use client"

import React from "react"

import { useRef, useEffect } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"

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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end rounded-xl border border-border bg-card transition-colors focus-within:border-primary/50">
          <textarea
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
            className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            disabled={isLoading}
          />
          {isLoading ? (
            <button
              onClick={onStop}
              className="m-1.5 flex h-8 shrink-0 items-center justify-center rounded-lg bg-secondary px-3 text-xs font-medium text-foreground transition-all hover:bg-secondary/80"
              aria-label="Stop generating"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!input.trim()}
              className={cn(
                "m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all",
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
