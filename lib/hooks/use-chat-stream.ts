"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import { readSseStream } from "@/lib/chat/sse"

interface UseChatStreamParams {
  knowledgeBaseId?: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  scrollToBottom: () => void
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

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 100
}

export function useChatStream({ knowledgeBaseId, scrollRef, scrollToBottom }: UseChatStreamParams) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const streamBufferRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)

  const flushAssistantBuffer = useCallback(() => {
    const assistantId = streamingAssistantIdRef.current
    const delta = streamBufferRef.current

    if (!assistantId || !delta) {
      flushRafRef.current = null
      return
    }

    const element = scrollRef.current
    const shouldScroll = element ? isNearBottom(element) : true

    streamBufferRef.current = ""
    setMessages((prev) => {
      const next = [...prev]
      const assistantIndex = next.findIndex((message) => message.id === assistantId)
      if (assistantIndex === -1) return next

      const current = next[assistantIndex]
      next[assistantIndex] = createTextMessage("assistant", `${getMessageText(current)}${delta}`, assistantId)
      return next
    })
    flushRafRef.current = null

    if (shouldScroll) {
      requestAnimationFrame(() => {
        scrollToBottom()
      })
    }
  }, [scrollRef, scrollToBottom])

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null) return

    flushRafRef.current = requestAnimationFrame(() => {
      flushAssistantBuffer()
    })
  }, [flushAssistantBuffer])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (flushRafRef.current != null) {
        cancelAnimationFrame(flushRafRef.current)
      }
    }
  }, [])

  const handleStop = useCallback(() => {
    if (!isLoading) return
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [isLoading])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmedText = text.trim()
      if (!trimmedText || isLoading) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const userMessage = createTextMessage("user", trimmedText)
      const assistantId = crypto.randomUUID()
      const assistantMessage = createTextMessage("assistant", "", assistantId)

      streamingAssistantIdRef.current = assistantId
      setMessages((prev) => [...prev, userMessage, assistantMessage])
      requestAnimationFrame(() => {
        scrollToBottom()
      })
      setIsLoading(true)
      setIsStreaming(true)

      try {
        const clientMessageId = crypto.randomUUID()
        const shouldDebugStream =
          process.env.NODE_ENV === "development" &&
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("debugStream") === "1"

        const payload: {
          message: string
          clientMessageId: string
          knowledgeBaseId?: string
          debug?: { delayMs: number; repeat: number; chunkBy: "char" | "word" }
        } = {
          message: trimmedText,
          clientMessageId,
        }

        if (knowledgeBaseId) {
          payload.knowledgeBaseId = knowledgeBaseId
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
          const payload = await response.json().catch(() => ({ error: "Request failed" }))
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

        await readSseStream(response.body as ReadableStream<Uint8Array>, ({ event, data }) => {
          if (event === "meta") {
            requestId =
              data && typeof data === "object" && "requestId" in data && typeof data.requestId === "string"
                ? data.requestId
                : undefined
            return
          }

          if (event === "token") {
            const delta =
              data && typeof data === "object" && "delta" in data && typeof data.delta === "string"
                ? data.delta
                : ""

            if (delta.length > 0) {
              streamBufferRef.current += delta
              scheduleFlush()
            }
          }

          if (event === "error") {
            streamError =
              data && typeof data === "object" && "message" in data && typeof data.message === "string"
                ? data.message
                : "Stream error"
          }
        })

        if (streamError) {
          const prefix = requestId ? `[${requestId}] ` : ""
          throw new Error(prefix + streamError)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? createTextMessage("assistant", `${getMessageText(message)}\n\n[Stopped]`, assistantId)
                : message
            )
          )
        } else {
          const errorMessage = error instanceof Error ? error.message : "Stream error"
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
        setIsStreaming(false)
      }

      if (streamBufferRef.current) {
        flushAssistantBuffer()
      }
    },
    [flushAssistantBuffer, isLoading, knowledgeBaseId, scheduleFlush, scrollToBottom]
  )

  return {
    messages,
    isLoading,
    isStreaming,
    handleStop,
    sendMessage,
  }
}
