'use client';

import { useState, useRef, useEffect, useCallback } from "react"
import type { UIMessage } from "ai"
import {
  KnowledgePanel,
  type KnowledgeItem,
} from "@/components/knowledge-panel"
import { ChatMessages } from "@/components/chat-messages"
import { ChatInput } from "@/components/chat-input"
import { EmptyState } from "@/components/empty-state"

type ParsedSseEvent = {
  event: string
  data: unknown
}

function createTextMessage(
  role: "user" | "assistant",
  text: string,
  id = crypto.randomUUID()
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  }
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function parseSseEvent(rawEvent: string): ParsedSseEvent | null {
  const lines = rawEvent.split("\n")
  let event = "message"
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null

  const rawData = dataLines.join("\n")
  try {
    return { event, data: JSON.parse(rawData) }
  } catch {
    return { event, data: rawData }
  }
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedSseEvent) => void
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, "\n")

    let boundary = buffer.indexOf("\n\n")
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 2)

      if (rawEvent.length > 0) {
        const parsed = parseSseEvent(rawEvent)
        if (parsed) {
          onEvent(parsed)
        }
      }

      boundary = buffer.indexOf("\n\n")
    }
  }

  const lastEvent = buffer.trim()
  if (lastEvent.length > 0) {
    const parsed = parseSseEvent(lastEvent)
    if (parsed) {
      onEvent(parsed)
    }
  }
}

export default function ChatPage() {
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([])
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isLoading])

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleStop = useCallback(() => {
    if (!isLoading) return
    abortRef.current?.abort()
  }, [isLoading])

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

  const appendAssistantDelta = useCallback((assistantId: string, delta: string) => {
    setMessages((prev) => {
      const next = [...prev]
      const assistantIndex = next.findIndex((message) => message.id === assistantId)
      if (assistantIndex === -1) return next

      const current = next[assistantIndex]
      const mergedText = `${getMessageText(current)}${delta}`
      next[assistantIndex] = createTextMessage("assistant", mergedText, assistantId)
      return next
    })
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    const trimmedText = text.trim()
    if (!trimmedText || isLoading) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMessage = createTextMessage("user", trimmedText)
    const assistantId = crypto.randomUUID()
    const assistantMessage = createTextMessage("assistant", "", assistantId)

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setIsLoading(true)

    try {
      const clientMessageId = crypto.randomUUID()
      const shouldDebugStream =
        process.env.NODE_ENV === "development" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debugStream") === "1"
      const payload: {
        message: string
        clientMessageId: string
        knowledge: { title: string; content: string }[]
        debug?: { delayMs: number; repeat: number; chunkBy: "char" | "word" }
      } = {
        message: trimmedText,
        clientMessageId,
        knowledge: knowledgeItems.map((item) => ({
          title: item.title,
          content: item.content,
        })),
      }

      if (shouldDebugStream) {
        payload.debug = {
          delayMs: 120,
          repeat: 200,
          chunkBy: "char",
        }
      }

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: "Request failed" }))
        const message =
          payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string"
            ? payload.error
            : response.statusText
        throw new Error(message)
      }

      if (!response.body) {
        throw new Error("Empty stream response")
      }

      let streamError: string | null = null
      let requestId: string | undefined

      await readSseStream(
        response.body as ReadableStream<Uint8Array>,
        ({ event, data }) => {
          if (event === "meta") {
            requestId =
              data && typeof data === "object" && "requestId" in data && typeof data.requestId === "string"
                ? data.requestId
                : undefined
            return
          }
          if (event === "token") {
            const delta =
              data &&
                typeof data === "object" &&
                "delta" in data &&
                typeof data.delta === "string"
                ? data.delta
                : ""
            if (delta.length > 0) {
              appendAssistantDelta(assistantId, delta)
            }
          }

          if (event === "error") {
            streamError =
              data && typeof data === "object" && "message" in data && typeof data.message === "string"
                ? data.message
                : "Stream error"
          }
        }
      )
      if (streamError) {
          const prefix = requestId ? `[${requestId}] ` : ""
          throw new Error(prefix + streamError)
      }

    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? createTextMessage("assistant", `${getMessageText(m)}\n\n[Stopped]`, assistantId)
              : m
          )
        )
      } else {
        const errorMessage = err instanceof Error ? err.message : "Stream error"
        setMessages((prev) =>
          prev.map((message) => {
            if (message.id !== assistantId) return message
            const fallbackText = getMessageText(message)
            const nextText =
              fallbackText.length > 0
                ? `${fallbackText}\n\n[Error] ${errorMessage}`
                : `[Error] ${errorMessage}`
            return createTextMessage("assistant", nextText, assistantId)
          })
        )
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setIsLoading(false)
    }
  }, [appendAssistantDelta, isLoading, knowledgeItems])

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return
    const nextInput = input
    setInput("")
    void sendMessage(nextInput)
  }, [input, isLoading, sendMessage])

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (isLoading) return
      void sendMessage(text)
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
          onStop={handleStop}
          isLoading={isLoading}
          hasKnowledge={hasKnowledge}
        />
      </div>
    </div>
  )
}
