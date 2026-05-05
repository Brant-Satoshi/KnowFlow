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
  onCreateConversation?: () => Promise<string | null>
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
  onCreateConversation,
}: UseChatStreamParams) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [citationsMap, setCitationsMap] = useState<Map<string, RetrievedChunk[]>>(new Map())
  const [progressMap, setProgressMap] = useState<Map<string, AssistantProgress>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  const streamBufferRef = useRef("")
  const fullTextRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)
  const retrievedChunksRef = useRef<RetrievedChunk[]>([])
  const hydrationGenRef = useRef(0)
  const lastUserTextRef = useRef<string | null>(null)
  // Tracks the conversation id of an in-flight stream that this hook itself
  // initiated (typically via on-the-fly creation in sendMessage). Lets the
  // hydration effect skip its destructive abort/refetch when the parent
  // updates `conversationId` to match what we're already streaming to.
  const activeStreamConversationIdRef = useRef<string | null>(null)

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
    // If the parent just synced `conversationId` to a value we created
    // ourselves inside sendMessage, the local state is already correct and
    // re-hydrating would abort our in-flight stream.
    if (conversationId && conversationId === activeStreamConversationIdRef.current) {
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
          setProgressMap(new Map())
          return
        }
        const stored: StoredMessage[] = json.data.conversation.messages ?? []
        const { messages: hydrated, citations } = hydrateFromStored(stored)
        setMessages(hydrated)
        setCitationsMap(citations)
        setProgressMap(new Map())
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return
        if (generation !== hydrationGenRef.current) return
        setMessages([])
        setCitationsMap(new Map())
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

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmedText = text.trim()
      if (!trimmedText || isLoading) return

      // Resolve the target conversation. In draft mode (no conversationId)
      // create one on demand so the user's first send produces both the
      // conversation and its first turn atomically.
      let effectiveConversationId = conversationId
      if (!effectiveConversationId) {
        if (!onCreateConversation) return
        const created = await onCreateConversation()
        if (!created) return
        effectiveConversationId = created
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      activeStreamConversationIdRef.current = effectiveConversationId

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
          conversationId: effectiveConversationId,
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

          if (event === "progress") {
            if (!data || typeof data !== "object" || !("stage" in data)) return
            const stage = (data as { stage?: unknown }).stage
            if (typeof stage !== "string" || !isProgressStage(stage)) return
            const at = Date.now()
            const meta = (() => {
              const d = data as {
                recalledCount?: number
                finalCount?: number
                rerankSkipped?: boolean
              }
              const nextMeta: ProgressStep["meta"] = {}
              if (typeof d.recalledCount === "number") nextMeta.count = d.recalledCount
              if (typeof d.finalCount === "number") nextMeta.count = d.finalCount
              if (d.rerankSkipped === true) nextMeta.skipped = true
              return Object.keys(nextMeta).length > 0 ? nextMeta : undefined
            })()
            if (stage === "generating") generatingSeen = true
            appendStep(assistantId, { stage, at, meta })
            return
          }

          if (event === "token") {
            const delta =
              data && typeof data === "object" && "delta" in data && typeof data.delta === "string"
                ? data.delta
                : ""

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
              data && typeof data === "object" && "message" in data && typeof data.message === "string"
                ? data.message
                : "Stream error"
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
        if (activeStreamConversationIdRef.current === effectiveConversationId) {
          activeStreamConversationIdRef.current = null
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
    [appendStep, conversationId, flushAssistantBuffer, isLoading, knowledgeBaseId, onCreateConversation, scheduleFlush, scrollToBottom, updateProgress]
  )

  // v1: regenerate the LAST assistant turn only. Removes the trailing user +
  // assistant pair from both local state and the DB, then re-issues the same
  // user query so a fresh turn is appended.
  const regenerateLast = useCallback(async () => {
    if (isLoading || !conversationId) return
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
    void sendMessage(lastUserText)
  }, [conversationId, isLoading, messages, sendMessage])

  return {
    messages,
    isLoading,
    isStreaming,
    isHydrating,
    citationsMap,
    progressMap,
    handleStop,
    sendMessage,
    regenerateLast,
  }
}
