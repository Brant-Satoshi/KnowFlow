"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import { readSseStream } from "@/lib/chat/sse"
import type { RetrievedChunk, StoredMessage } from "@/lib/types"

interface UseChatStreamParams {
  knowledgeBaseId?: string
  conversationId?: string
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

function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]+`/g, "")
}

function parseUsedIndices(text: string): Set<number> {
  const prose = stripCode(text)
  const indices = new Set<number>()
  for (const m of prose.matchAll(/(?<!\w)\[(\d+)\]/g)) {
    indices.add(parseInt(m[1], 10))
  }
  return indices
}

function hydrateFromStored(
  stored: StoredMessage[]
): { messages: UIMessage[]; citations: Map<string, RetrievedChunk[]> } {
  const messages: UIMessage[] = []
  const citations = new Map<string, RetrievedChunk[]>()

  for (const m of stored) {
    const ui = createTextMessage(m.role, m.content, m.id)
    messages.push(ui)

    if (m.role === "assistant" && m.retrievedChunks && m.retrievedChunks.length > 0) {
      const used = parseUsedIndices(m.content)
      const cited = m.retrievedChunks.filter((c) => used.has(c.index))
      if (cited.length > 0) citations.set(m.id, cited)
    }
  }

  return { messages, citations }
}

export function useChatStream({
  knowledgeBaseId,
  conversationId,
  scrollRef,
  scrollToBottom,
}: UseChatStreamParams) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [citationsMap, setCitationsMap] = useState<Map<string, RetrievedChunk[]>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  const streamBufferRef = useRef("")
  const fullTextRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)
  const retrievedChunksRef = useRef<RetrievedChunk[]>([])
  const hydrationGenRef = useRef(0)

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

  // Hydrate from server when conversation changes.
  useEffect(() => {
    abortRef.current?.abort()
    setIsLoading(false)
    setIsStreaming(false)
    streamBufferRef.current = ""
    fullTextRef.current = ""
    retrievedChunksRef.current = []
    streamingAssistantIdRef.current = null

    if (!conversationId) {
      setMessages([])
      setCitationsMap(new Map())
      setIsHydrating(false)
      return
    }

    const generation = ++hydrationGenRef.current
    setIsHydrating(true)

    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, {
          signal: controller.signal,
        })
        const json = await res.json()
        if (generation !== hydrationGenRef.current) return
        if (!json.ok || !json.data?.conversation) {
          setMessages([])
          setCitationsMap(new Map())
          return
        }
        const stored: StoredMessage[] = json.data.conversation.messages ?? []
        const { messages: hydrated, citations } = hydrateFromStored(stored)
        setMessages(hydrated)
        setCitationsMap(citations)
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return
        if (generation !== hydrationGenRef.current) return
        setMessages([])
        setCitationsMap(new Map())
      } finally {
        if (generation === hydrationGenRef.current) {
          setIsHydrating(false)
        }
      }
    }
    void load()

    return () => {
      controller.abort()
    }
  }, [conversationId])

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
      if (!trimmedText || isLoading || !conversationId) return

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
          conversationId: string
          knowledgeBaseId?: string
          debug?: { delayMs: number; repeat: number; chunkBy: "char" | "word" }
        } = {
          message: trimmedText,
          clientMessageId,
          conversationId,
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
            if (
              data &&
              typeof data === "object" &&
              "retrievedChunks" in data &&
              Array.isArray(data.retrievedChunks)
            ) {
              retrievedChunksRef.current = data.retrievedChunks as RetrievedChunk[]
            }
            return
          }

          if (event === "token") {
            const delta =
              data && typeof data === "object" && "delta" in data && typeof data.delta === "string"
                ? data.delta
                : ""

            if (delta.length > 0) {
              streamBufferRef.current += delta
              fullTextRef.current += delta
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

      const usedIndices = parseUsedIndices(fullTextRef.current)
      const citations = retrievedChunksRef.current.filter((c) => usedIndices.has(c.index))
      if (citations.length > 0) {
        setCitationsMap((prev) => {
          const next = new Map(prev)
          next.set(assistantId, citations)
          return next
        })
      }
      fullTextRef.current = ""
      retrievedChunksRef.current = []
    },
    [conversationId, flushAssistantBuffer, isLoading, knowledgeBaseId, scheduleFlush, scrollToBottom]
  )

  return {
    messages,
    isLoading,
    isStreaming,
    isHydrating,
    citationsMap,
    handleStop,
    sendMessage,
  }
}
