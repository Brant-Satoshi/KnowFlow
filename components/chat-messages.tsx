"use client"

import type { UIMessage } from "ai"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import { Sparkles } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { cn } from "@/lib/utils"

function getUIMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""

  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function parseSourcesFromText(text: string): {
  cleanText: string
  sources: string[]
} {
  const sourcePattern = /\[Source:\s*([^\]]+)\]/g
  const sources: string[] = []
  let match: RegExpExecArray | null

  match = sourcePattern.exec(text)
  while (match !== null) {
    sources.push(match[1].trim())
    match = sourcePattern.exec(text)
  }

  return {
    cleanText: text.replace(sourcePattern, "").trim(),
    sources,
  }
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap leading-7 [&:not(:first-child)]:mt-4">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-current">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline decoration-primary/35 underline-offset-4"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = Boolean(className)

    if (isBlock) {
      return <code className={cn("font-mono text-[13px]", className)}>{children}</code>
    }

    return (
      <code className="rounded-md bg-black/6 px-1.5 py-0.5 font-mono text-[13px] text-foreground dark:bg-white/10">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-black/8 bg-black/[0.035] p-4 text-sm dark:border-white/10 dark:bg-white/[0.04]">
      {children}
    </pre>
  ),
}

interface SourceBadgeProps {
  index: number
  title: string
}

function SourceBadge({ index, title }: SourceBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#cbd6e7] bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-700 dark:border-white/10 dark:bg-white/8 dark:text-slate-200">
      <span className="text-[10px] text-slate-500 dark:text-slate-400">[{index}]</span>
      <span className="max-w-[18rem] truncate">{title}</span>
    </span>
  )
}

function RoleAvatar() {
  return (
    <div
      className="mt-2 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e0d0aa] bg-[#fbf2d9] text-[#9b6c12] sm:flex dark:border-[#5b4920] dark:bg-[#2b2519] dark:text-[#f5c86b]"
    >
      <Sparkles className="h-4 w-4" />
    </div>
  )
}

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean
  isStreaming: boolean
}

export function ChatMessages({ messages, isLoading, isStreaming }: ChatMessagesProps) {
  const latestMessageId = messages[messages.length - 1]?.id
  const { t } = useLanguage()

  return (
    <div className="flex flex-col gap-8 pb-2">
      {messages.map((message) => {
        const text = getUIMessageText(message)
        const isUser = message.role === "user"
        const isStreamingMessage = isStreaming && !isUser && message.id === latestMessageId
        const isAssistantLoading = isLoading && !isUser && message.id === latestMessageId && text.length === 0
        const { cleanText, sources } = isUser ? { cleanText: text, sources: [] } : parseSourcesFromText(text)

        return (
          <div key={message.id} className={cn("flex items-start gap-3", isUser && "justify-end")}>
            {!isUser && <RoleAvatar />}

            <div className={cn("max-w-[min(100%,54rem)] space-y-2", isUser && "text-right")}>
              {!isUser && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {t.assistantLabel}
                  </span>
                </div>
              )}

              <div
                className={cn(
                  "rounded-[1rem] border px-5 py-4 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.45)]",
                  isUser
                    ? "border-transparent theme-user-msg-bg theme-user-msg-text"
                    : "border-white/60 bg-white/82 text-card-foreground backdrop-blur-sm dark:border-white/10 dark:bg-[#141a22]/88"
                )}
              >
                {isAssistantLoading ? (
                  <div className="flex h-8 items-center gap-1.5" role="status" aria-label="Generating response">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <span
                        key={index}
                        className="loading-dot-breathe h-2.5 w-2.5 rounded-full bg-primary/70"
                        style={{ animationDelay: `${index * 140}ms` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-current">
                    {isStreamingMessage ? (
                      <div className="whitespace-pre-wrap break-words leading-7">
                        {cleanText}
                        <span
                          aria-hidden="true"
                          className="streaming-cursor ml-1 inline-block h-[1.1em] w-0.5 translate-y-0.5 rounded-full bg-primary align-[-0.1em]"
                        />
                      </div>
                    ) : (
                      <ReactMarkdown components={markdownComponents}>{cleanText}</ReactMarkdown>
                    )}
                  </div>
                )}
              </div>

              {sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    {t.sourcesLabel}
                  </span>
                  {sources.map((source, index) => (
                    <SourceBadge key={`${message.id}-source-${index}`} index={index + 1} title={source} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
