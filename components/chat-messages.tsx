"use client"

import type { UIMessage } from "ai"
import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import { Sparkles } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { cn } from "@/lib/utils"
import type { RetrievedChunk } from "@/lib/types"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

function getUIMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map(p => p.text)
    .join("")
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="whitespace-pre-wrap leading-7 [&:not(:first-child)]:mt-4">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-current">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer"
      className="font-medium text-primary underline decoration-primary/35 underline-offset-4">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className={cn("font-mono text-[13px]", className)}>{children}</code>
    }
    return (
      <code className="rounded-md bg-primary/8 px-1.5 py-0.5 font-mono text-[13px] text-foreground dark:bg-primary/12">
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-secondary p-4 text-sm">
      {children}
    </pre>
  ),
}

function SourceBadge({ chunk }: { chunk: RetrievedChunk }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-secondary px-2.5 py-1 font-mono text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground">
          <span className="text-[9.5px] text-muted-foreground/70">[{chunk.index}]</span>
          <span className="max-w-[18rem] truncate">{chunk.fileName}</span>
          {chunk.page != null && (
            <span className="text-[9.5px] text-muted-foreground/60">p.{chunk.page}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 rounded-[10px] text-xs leading-6 text-muted-foreground" side="top">
        <p className="line-clamp-6">{chunk.quote}</p>
      </PopoverContent>
    </Popover>
  )
}

function RoleAvatar() {
  return (
    <div className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-primary/25 bg-primary/10 text-primary sm:flex">
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  )
}

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean
  isStreaming: boolean
  citationsMap: Map<string, RetrievedChunk[]>
}

export function ChatMessages({
  messages,
  isLoading,
  isStreaming,
  citationsMap,
}: ChatMessagesProps) {
  const latestMessageId = messages[messages.length - 1]?.id
  const { t } = useLanguage()

  return (
    <div className="flex flex-col gap-6 pb-2">
      {messages.map(message => {
        const text = getUIMessageText(message)
        const isUser = message.role === "user"
        const isStreamingMessage = isStreaming && !isUser && message.id === latestMessageId
        const isAssistantLoading = isLoading && !isUser && message.id === latestMessageId && text.length === 0
        const citations = isUser ? [] : (citationsMap.get(message.id) ?? [])

        return (
          <div key={message.id} className={cn("flex items-start gap-3", isUser && "justify-end")}>
            {!isUser && <RoleAvatar />}

            <div className={cn("max-w-[min(100%,54rem)] space-y-2", isUser && "text-right")}>
              {!isUser && (
                <div className="flex items-center gap-2 px-0.5">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {t.assistantLabel}
                  </span>
                </div>
              )}

              <div className={cn(
                "rounded-[14px] border px-4 py-3",
                isUser
                  ? "border-transparent theme-user-msg-bg theme-user-msg-text rounded-br-[4px]"
                  : "rounded-tl-[4px] border-border bg-card text-card-foreground"
              )}>
                {isAssistantLoading ? (
                  <div className="flex h-7 items-center gap-1.5" role="status" aria-label="Generating response">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <span
                        key={i}
                        className="loading-dot-breathe h-2 w-2 rounded-full bg-primary/60"
                        style={{ animationDelay: `${i * 140}ms` }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-current">
                    {isStreamingMessage ? (
                      <div className="whitespace-pre-wrap break-words leading-7">
                        {text}
                        <span
                          aria-hidden="true"
                          className="streaming-cursor ml-1 inline-block h-[1.05em] w-0.5 translate-y-0.5 rounded-full bg-primary align-[-0.1em]"
                        />
                      </div>
                    ) : (
                      <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>
                    )}
                  </div>
                )}
              </div>

              {citations.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    {t.sourcesLabel}
                  </span>
                  {citations.map(chunk => (
                    <SourceBadge key={`${message.id}-${chunk.index}`} chunk={chunk} />
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
