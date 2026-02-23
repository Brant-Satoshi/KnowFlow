'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
  KnowledgePanel,
  type KnowledgeItem,
} from "@/components/knowledge-panel"
import { ChatMessages } from "@/components/chat-messages"
import { ChatInput } from "@/components/chat-input"
import { EmptyState } from "@/components/empty-state"

export default function ChatPage() {
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([])
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: "/api/chat/stream",
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: {
          messages,
          id,
          knowledge: knowledgeItems.map((item) => ({
            title: item.title,
            content: item.content,
          })),
        },
      }),
    })
  }, [knowledgeItems])

  const { messages, sendMessage, status } = useChat({ transport })

  const isLoading = status === "streaming" || status === "submitted"

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isLoading])

  const handleAddKnowledge = useCallback(
    (item: Omit<KnowledgeItem, "id" | "createdAt">) => {
      const genId = () =>
      (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
      setKnowledgeItems((prev) => [
        ...prev,
        {
          ...item,
          id: genId(),
          createdAt: new Date(),
        },
      ])
    },
    []
  )

  const handleRemoveKnowledge = useCallback((id: string) => {
    setKnowledgeItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handleSubmit = useCallback(async() => {
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput("")
  }, [input, isLoading, sendMessage])

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (isLoading) return
      sendMessage({ text })
    },
    [isLoading, sendMessage]
  )

  const hasKnowledge = knowledgeItems.length > 0
  const hasMessages = messages.length > 0

  return (
    <div className="flex h-dvh overflow-hidden">
      <KnowledgePanel
        items={knowledgeItems}
        onAdd={handleAddKnowledge}
        onRemove={handleRemoveKnowledge}
        collapsed={panelCollapsed}
        onToggle={() => setPanelCollapsed((p) => !p)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-foreground">AskBase</h1>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
              RAG
            </span>
          </div>
          {hasKnowledge && (
            <span className="text-xs text-muted-foreground">
              {knowledgeItems.length} document
              {knowledgeItems.length !== 1 ? "s" : ""} loaded
            </span>
          )}
        </header>

        {hasMessages ? (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-3xl">
              <ChatMessages messages={messages} isLoading={isLoading} />
            </div>
          </div>
        ) : (
          <EmptyState
            hasKnowledge={hasKnowledge}
            onSuggestionClick={handleSuggestionClick}
          />
        )}

        <ChatInput
          input={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          hasKnowledge={hasKnowledge}
        />
      </div>
    </div>
  )
}