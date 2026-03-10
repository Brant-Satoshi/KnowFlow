"use client"

import { Sparkles, FileText, MessageSquare, Zap } from "lucide-react"

interface EmptyStateProps {
  hasKnowledge: boolean
  onSuggestionClick: (text: string) => void
}

const suggestions = [
  {
    icon: FileText,
    text: "Summarize the key points",
    description: "Get a concise overview",
  },
  {
    icon: MessageSquare,
    text: "What are the main topics covered?",
    description: "Understand the structure",
  },
  {
    icon: Zap,
    text: "Find actionable insights",
    description: "Extract recommendations",
  },
]

export function EmptyState({
  hasKnowledge,
  onSuggestionClick,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center text-center">
        {/* Logo */}
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>

        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          AskBase
        </h1>
        <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          {hasKnowledge
            ? "Your knowledge base is ready. Ask any question and get answers grounded in your documents."
            : "Add documents to your knowledge base, then ask questions to get AI-powered answers with source citations."}
        </p>

        {/* Suggestions */}
        {hasKnowledge && (
          <div className="mt-8 flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.text}
                onClick={() => onSuggestionClick(suggestion.text)}
                className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-card/80"
              >
                <suggestion.icon className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {suggestion.text}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {suggestion.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Guide when no knowledge */}
        {!hasKnowledge && (
          <div className="mt-8 flex items-center gap-2 rounded-lg bg-primary/5 px-4 py-2.5 text-xs text-primary">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>
              Open the knowledge panel on the left to add your first document
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
