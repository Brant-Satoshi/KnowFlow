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

export type ProgressStage =
  | "understanding"
  | "searching"
  | "searched"
  | "reranking"
  | "reranked"
  | "generating"
  | "done"
  | "error"
  | "stopped"

export type ActiveProgressStage =
  | "understanding"
  | "searching"
  | "reranking"
  | "generating"

export interface ProgressStep {
  stage: ProgressStage
  at: number
  meta?: { count?: number; skipped?: boolean }
  inferred?: boolean
}

export interface AssistantProgress {
  startedAt: number
  completedAt?: number
  steps: ProgressStep[]
  currentStage: ProgressStage
  failedStage?: ActiveProgressStage
  rerankSkipped?: boolean
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

function isProgressStage(stage: string): stage is ProgressStage {
  return (
    stage === "understanding" ||
    stage === "searching" ||
    stage === "searched" ||
    stage === "reranking" ||
    stage === "reranked" ||
    stage === "generating" ||
    stage === "done" ||
    stage === "error" ||
    stage === "stopped"
  )
}

function getLastActiveStage(progress: AssistantProgress): ActiveProgressStage {
  for (let i = progress.steps.length - 1; i >= 0; i--) {
    const stage = progress.steps[i].stage
    if (stage === "searched") return "searching"
    if (stage === "reranked") return "reranking"
    if (
      stage === "understanding" ||
      stage === "searching" ||
      stage === "reranking" ||
      stage === "generating"
    ) {
      return stage
    }
  }
  return "understanding"
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

// Keep this regex in sync with CITATION_PATTERN in components/inline-citation.tsx.
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
): {
  messages: UIMessage[]
  citations: Map<string, RetrievedChunk[]>
  retrievedChunks: Map<string, RetrievedChunk[]>
} {
  const messages: UIMessage[] = []
  const citations = new Map<string, RetrievedChunk[]>()
  const retrievedChunks = new Map<string, RetrievedChunk[]>()

  for (const m of stored) {
    const ui = createTextMessage(m.role, m.content, m.id)
    messages.push(ui)

    if (m.role === "assistant" && m.retrievedChunks && m.retrievedChunks.length > 0) {
      retrievedChunks.set(m.id, m.retrievedChunks)
      const used = parseUsedIndices(m.content)
      const cited = m.retrievedChunks.filter((c) => used.has(c.index))
      if (cited.length > 0) citations.set(m.id, cited)
    }
  }

  return { messages, citations, retrievedChunks }
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
  const [retrievedChunksMap, setRetrievedChunksMap] = useState<Map<string, RetrievedChunk[]>>(new Map())
  const [progressMap, setProgressMap] = useState<Map<string, AssistantProgress>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  const streamBufferRef = useRef("")
  const fullTextRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)
  const retrievedChunksRef = useRef<RetrievedChunk[]>([])
  const hydrationGenRef = useRef(0)
  const lastUserTextRef = useRef<string | null>(null)
  const isRegeneratingRef = useRef(false)
  const skipNextHydrationRef = useRef(false)

  const updateProgress = useCallback(
    (assistantId: string, mutator: (prev: AssistantProgress) => AssistantProgress) => {
      setProgressMap((prev) => {
        const current = prev.get(assistantId)
        if (!current) return prev
        const next = new Map(prev)
        next.set(assistantId, mutator(current))
        return next
      })
    },
    []
  )

  const appendStep = useCallback(
    (assistantId: string, step: ProgressStep) => {
      updateProgress(assistantId, (prev) => ({
        ...prev,
        steps: [...prev.steps, step],
        currentStage: step.stage,
        rerankSkipped:
          step.stage === "reranked" && step.meta?.skipped === true ? true : prev.rerankSkipped,
      }))
    },
    [updateProgress]
  )

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
    // When ensureConversation() flips a freshly-created id into state right
    // before firing sendMessage(), the in-flight stream's AbortController is
    // already on abortRef. Bail out before touching it, or we cancel our own
    // request and the user sees "[Stopped]".
    if (conversationId && skipNextHydrationRef.current) {
      skipNextHydrationRef.current = false
      return
    }

    abortRef.current?.abort()
    setIsLoading(false)
    setIsStreaming(false)
    streamBufferRef.current = ""
    fullTextRef.current = ""
    retrievedChunksRef.current = []
    streamingAssistantIdRef.current = null
    lastUserTextRef.current = null

    if (!conversationId) {
      setMessages([])
      setCitationsMap(new Map())
      setRetrievedChunksMap(new Map())
      setProgressMap(new Map())
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
          setRetrievedChunksMap(new Map())
          setProgressMap(new Map())
          return
        }
        const stored: StoredMessage[] = json.data.conversation.messages ?? []
        const { messages: hydrated, citations, retrievedChunks } = hydrateFromStored(stored)
        setMessages(hydrated)
        setCitationsMap(citations)
        setRetrievedChunksMap(retrievedChunks)
        setProgressMap(new Map())
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return
        if (generation !== hydrationGenRef.current) return
        setMessages([])
        setCitationsMap(new Map())
        setRetrievedChunksMap(new Map())
        setProgressMap(new Map())
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

  const skipNextHydration = useCallback(() => {
    skipNextHydrationRef.current = true
  }, [])

  const sendMessage = useCallback(
    async (text: string, overrideConversationId?: string) => {
      const trimmedText = text.trim()
      const effectiveConvId = overrideConversationId ?? conversationId
      if (!trimmedText || isLoading || !effectiveConvId) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const userMessageId = crypto.randomUUID()
      const userMessage = createTextMessage("user", trimmedText, userMessageId)
      // Single id used as: assistant message id, requestId on the wire, and progressMap key.
      const assistantId = crypto.randomUUID()
      const assistantMessage = createTextMessage("assistant", "", assistantId)

      streamingAssistantIdRef.current = assistantId
      lastUserTextRef.current = trimmedText
      setMessages((prev) => [...prev, userMessage, assistantMessage])

      const startedAt = Date.now()
      setProgressMap((prev) => {
        const next = new Map(prev)
        next.set(assistantId, {
          startedAt,
          steps: [{ stage: "understanding", at: startedAt }],
          currentStage: "understanding",
        })
        return next
      })

      requestAnimationFrame(() => {
        scrollToBottom()
      })
      setIsLoading(true)
      setIsStreaming(true)

      try {
        const payload: {
          message: string
          requestId: string
          userMessageId: string
          conversationId: string
          knowledgeBaseId?: string
        } = {
          message: trimmedText,
          requestId: assistantId,
          userMessageId,
          conversationId: effectiveConvId,
        }

        if (knowledgeBaseId) {
          payload.knowledgeBaseId = knowledgeBaseId
        }

        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        if (!response.ok) {
          const errPayload = await response.json().catch(() => ({ error: "Request failed" }))
          const errorMessage =
            errPayload &&
            typeof errPayload === "object" &&
            "error" in errPayload &&
            typeof errPayload.error === "string"
              ? errPayload.error
              : response.statusText
          throw new Error(errorMessage)
        }

        if (!response.body) {
          throw new Error("Empty stream response")
        }

        let streamError: string | null = null
        let firstTokenSeen = false
        let generatingSeen = false

        await readSseStream(response.body as ReadableStream<Uint8Array>, ({ event, data }) => {
          if (event === "meta") {
            if (isObject(data) && Array.isArray(data.retrievedChunks)) {
              const chunks = data.retrievedChunks as RetrievedChunk[]
              retrievedChunksRef.current = chunks
              setRetrievedChunksMap((prev) => {
                const next = new Map(prev)
                next.set(assistantId, chunks)
                return next
              })
            }
            return
          }

          if (event === "progress") {
            if (!isObject(data)) return
            const stage = data.stage
            if (typeof stage !== "string" || !isProgressStage(stage)) return
            const at = Date.now()
            const nextMeta: ProgressStep["meta"] = {}
            if (typeof data.recalledCount === "number") nextMeta.count = data.recalledCount
            if (typeof data.finalCount === "number") nextMeta.count = data.finalCount
            if (data.rerankSkipped === true) nextMeta.skipped = true
            const meta = Object.keys(nextMeta).length > 0 ? nextMeta : undefined
            if (stage === "generating") generatingSeen = true
            appendStep(assistantId, { stage, at, meta })
            return
          }

          if (event === "token") {
            const delta =
              isObject(data) && typeof data.delta === "string" ? data.delta : ""

            if (!firstTokenSeen) {
              firstTokenSeen = true
              if (!generatingSeen) {
                if (process.env.NODE_ENV === "development") {
                  console.warn(
                    "[chat-stream] first token arrived before progress { stage: 'generating' } — falling back to client-side inference"
                  )
                }
                appendStep(assistantId, { stage: "generating", at: Date.now(), inferred: true })
                generatingSeen = true
              }
            }

            if (delta.length > 0) {
              streamBufferRef.current += delta
              fullTextRef.current += delta
              scheduleFlush()
            }
          }

          if (event === "error") {
            streamError =
              isObject(data) && typeof data.message === "string" ? data.message : "Stream error"
          }
        })

        if (streamError) {
          throw new Error(streamError)
        }

        updateProgress(assistantId, (prev) => ({
          ...prev,
          completedAt: Date.now(),
          currentStage: "done",
        }))
      } catch (error) {
        const isStopped = error instanceof DOMException && error.name === "AbortError"
        if (isStopped) {
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
        updateProgress(assistantId, (prev) => ({
          ...prev,
          completedAt: Date.now(),
          currentStage: isStopped ? "stopped" : "error",
          failedStage: getLastActiveStage(prev),
        }))
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
    [appendStep, conversationId, flushAssistantBuffer, isLoading, knowledgeBaseId, scheduleFlush, scrollToBottom, updateProgress]
  )

  // v1: regenerate the LAST assistant turn only. Removes the trailing user +
  // assistant pair from both local state and the DB, then re-issues the same
  // user query so a fresh turn is appended.
  const regenerateLast = useCallback(async () => {
    if (isLoading || !conversationId || isRegeneratingRef.current) return
    isRegeneratingRef.current = true
    try {
      let lastUserId: string | null = null
      let lastUserText: string | null = null
      let lastAssistantId: string | null = null
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role === "assistant" && lastAssistantId === null) {
          lastAssistantId = m.id
          continue
        }
        if (m.role === "user") {
          lastUserId = m.id
          lastUserText = getMessageText(m)
          break
        }
      }
      if (!lastUserText || !lastUserId || !lastAssistantId) return

      const idsToDelete = [lastUserId, lastAssistantId]
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageIds: idsToDelete }),
        })
        if (!res.ok) throw new Error("Failed to delete messages")
      } catch (err) {
        console.error("[chat-stream] regenerate: delete failed, aborting", err)
        return
      }

      setMessages((prev) => prev.filter((m) => m.id !== lastUserId && m.id !== lastAssistantId))
      setProgressMap((prev) => {
        if (!prev.has(lastAssistantId!)) return prev
        const next = new Map(prev)
        next.delete(lastAssistantId!)
        return next
      })
      setCitationsMap((prev) => {
        if (!prev.has(lastAssistantId!)) return prev
        const next = new Map(prev)
        next.delete(lastAssistantId!)
        return next
      })
      setRetrievedChunksMap((prev) => {
        if (!prev.has(lastAssistantId!)) return prev
        const next = new Map(prev)
        next.delete(lastAssistantId!)
        return next
      })
      await sendMessage(lastUserText)
    } finally {
      isRegeneratingRef.current = false
    }
  }, [conversationId, isLoading, messages, sendMessage])

  return {
    messages,
    isLoading,
    isStreaming,
    isHydrating,
    citationsMap,
    retrievedChunksMap,
    progressMap,
    handleStop,
    sendMessage,
    regenerateLast,
    skipNextHydration,
  }
}
