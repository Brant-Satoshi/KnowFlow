"use client"

import type { UIMessage } from "ai"
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils"

function getUIMessageText(msg: UIMessage): string {
  if (!msg.parts || !Array.isArray(msg.parts)) return ""
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
}

interface SourceBadgeProps {
  index: number
  title: string
}

function SourceBadge({ index, title }: SourceBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <span className="text-[10px] text-primary/60">[{index}]</span>
      {title}
    </span>
  )
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

  const cleanText = text.replace(sourcePattern, "").trim()
  return { cleanText, sources }
}

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean,
  isStreaming: boolean
}

export function ChatMessages({ messages, isLoading, isStreaming }: ChatMessagesProps) {
  const latestMessageId = messages[messages.length - 1]?.id

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message) => {
        const text = getUIMessageText(message)
        const isUser = message.role === "user"
        const isAssistantLoading =
          isLoading &&
          !isUser &&
          message.id === latestMessageId &&
          text.trim().length === 0
        const { cleanText, sources } = isUser
          ? { cleanText: text, sources: [] }
          : parseSourcesFromText(text)

        return (
          <div
            key={message.id}
            className={cn("flex gap-3", isUser && "flex-row-reverse")}
          >
            <div
              className={cn(
                "max-w-[75%] space-y-2",
                isUser && "text-right"
              )}
            >
              <div
                className={cn(
                  "inline-block rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                  isUser
                    ? "theme-user-msg-bg theme-user-msg-text"
                    : "bg-card text-card-foreground"
                )}
              >
                {isAssistantLoading ? (
                  <div className="flex h-6 items-center" role="status" aria-label="Generating response">
                    <span className="loading-dot-breathe h-2 w-2 rounded-full bg-primary/70" />
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none">
                    {isStreaming ? (
                      <div className="whitespace-pre-wrap">{cleanText}</div>
                    ) : (
                      <ReactMarkdown>
                        {cleanText}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>

              {sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Sources
                  </span>
                  {sources.map((source, idx) => (
                    <SourceBadge
                      key={`${message.id}-source-${idx}`}
                      index={idx + 1}
                      title={source}
                    />
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
