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
  retrievedChunksMap: Map<string, RetrievedChunk[]>
  progressMap: Map<string, AssistantProgress>
  onRegenerate?: (messageId: string) => void
}

export function ChatMessages({
  messages,
  isLoading,
  isStreaming,
  citationsMap,
  retrievedChunksMap,
  progressMap,
  onRegenerate,
}: ChatMessagesProps) {
  const latestMessageId = messages[messages.length - 1]?.id

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
              <div className="max-w-[min(100%,54rem)] space-y-2 text-left">
                <div
                  className={cn(
                    "rounded-[22px] border border-transparent px-4 py-2",
                    "theme-user-msg-bg theme-user-msg-text",
                  )}
                >
                  <div className="text-base text-current">
                    <div className="whitespace-pre-wrap wrap-break-word leading-7">{text}</div>
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
            retrievedChunks={retrievedChunksMap.get(message.id) ?? []}
            progress={progressMap.get(message.id)}
            onRegenerate={onRegenerate}
            regenerateDisabled={isLoading || isStreaming}
          />
        )
      })}
    </div>
  )
}
