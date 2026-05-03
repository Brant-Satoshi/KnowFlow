"use client"

import type { UIMessage } from "ai"
import { cn } from "@/lib/utils"
import type { RetrievedChunk } from "@/lib/types"
import type { AssistantProgress } from "@/lib/hooks/use-chat-stream"
import { AssistantMessageCard } from "@/components/assistant-message-card"

function getUIMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map(p => p.text)
    .join("")
}

interface ChatMessagesProps {
  messages: UIMessage[]
  isLoading: boolean
  isStreaming: boolean
  citationsMap: Map<string, RetrievedChunk[]>
  progressMap: Map<string, AssistantProgress>
  onRegenerate?: () => void
}

export function ChatMessages({
  messages,
  isLoading,
  isStreaming,
  citationsMap,
  progressMap,
  onRegenerate,
}: ChatMessagesProps) {
  const latestMessageId = messages[messages.length - 1]?.id
  const latestAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id
    }
    return null
  })()

  return (
    <div className="flex flex-col gap-6 pb-2">
      {messages.map(message => {
        const text = getUIMessageText(message)
        const isUser = message.role === "user"
        const isStreamingMessage = isStreaming && !isUser && message.id === latestMessageId
        const isAssistantLoading = isLoading && !isUser && message.id === latestMessageId && text.length === 0

        if (isUser) {
          return (
            <div key={message.id} className="flex items-start justify-end gap-3">
              <div className="max-w-[min(100%,54rem)] space-y-2 text-right">
                <div
                  className={cn(
                    "rounded-[14px] rounded-br-[4px] border border-transparent px-4 py-3",
                    "theme-user-msg-bg theme-user-msg-text",
                  )}
                >
                  <div className="text-sm text-current">
                    <div className="whitespace-pre-wrap break-words leading-7">{text}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        return (
          <AssistantMessageCard
            key={message.id}
            messageId={message.id}
            text={text}
            isStreaming={isStreamingMessage}
            isLoading={isAssistantLoading}
            citations={citationsMap.get(message.id) ?? []}
            progress={progressMap.get(message.id)}
            isLatestAssistant={message.id === latestAssistantId}
            onRegenerate={onRegenerate}
            regenerateDisabled={isLoading || isStreaming}
          />
        )
      })}
    </div>
  )
}
