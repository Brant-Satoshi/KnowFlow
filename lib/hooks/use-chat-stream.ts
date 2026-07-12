"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { UIMessage } from "ai"
import { readSseStream } from "@/lib/chat/sse"
import { trailingSegmentStart } from "@/components/markdown/stream-fade"
import { httpClient } from "@/lib/http/client"
import type { RetrievalFilter, RetrievedChunk, StoredMessage } from "@/lib/types"

interface UseChatStreamParams {
  knowledgeBaseId?: string
  conversationId?: string
  /** OpenRouter model id (from catalog). When omitted, server uses its own default. */
  selectedModel?: string
  /** Retrieval filter sent with each request when any dimension is active. */
  retrievalFilter?: RetrievalFilter
  scrollRef: React.RefObject<HTMLDivElement | null>
  scrollToBottom: () => void
  onConversationTitleUpdated?: (conversationId: string, title: string) => void
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
  errorMessage?: string
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

// Keep this regex in sync with CITATION_PATTERN in components/chat/inline-citation.tsx.
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
  selectedModel,
  retrievalFilter,
  scrollRef,
  scrollToBottom,
  onConversationTitleUpdated,
}: UseChatStreamParams) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isHydrating, setIsHydrating] = useState(false)
  const [citationsMap, setCitationsMap] = useState<Map<string, RetrievedChunk[]>>(new Map())
  const [retrievedChunksMap, setRetrievedChunksMap] = useState<Map<string, RetrievedChunk[]>>(new Map())
  const [progressMap, setProgressMap] = useState<Map<string, AssistantProgress>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  // Mirror of `messages` so regenerateFrom can read the latest list without
  // depending on `messages` state — that dep would change its identity on
  // every streaming flush and defeat AssistantMessageCard's memo.
  const messagesRef = useRef<UIMessage[]>([])
  const streamBufferRef = useRef("")
  const fullTextRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)
  const retrievedChunksRef = useRef<RetrievedChunk[]>([])
  const hydrationGenRef = useRef(0)
  const lastUserTextRef = useRef<string | null>(null)
  const isRegeneratingRef = useRef(false)
  const skipNextHydrationRef = useRef(false)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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

  const flushAssistantBuffer = useCallback((opts?: { final?: boolean }) => {
    const assistantId = streamingAssistantIdRef.current
    let delta = streamBufferRef.current

    if (!assistantId || !delta) {
      flushRafRef.current = null
      return
    }

    // Hold the trailing partial word back so committed text always ends on a
    // word boundary: the stream-fade animation plays on mount only, so a word
    // must arrive complete to fade in — growing an already-mounted tail span
    // in place would pop the appended characters in without animating. The
    // held word commits with the flush after its boundary arrives (one delta
    // gap, ~12ms typ.); final flushes (done/abort) commit everything.
    if (opts?.final) {
      streamBufferRef.current = ""
    } else {
      const boundary = trailingSegmentStart(delta)
      if (boundary === 0) {
        // The whole buffer is one still-growing word; wait for its boundary.
        flushRafRef.current = null
        return
      }
      streamBufferRef.current = delta.slice(boundary)
      delta = delta.slice(0, boundary)
    }

    const element = scrollRef.current
    const shouldScroll = element ? isNearBottom(element) : true

    setMessages((prev) => {
      const next = [...prev]
      const assistantIndex = next.findIndex((message) => message.id === assistantId)
      if (assistantIndex === -1) return next

      const current = next[assistantIndex]
      next[assistantIndex] = createTextMessage("assistant", `${getMessageText(current)}${delta}`, assistantId)
      return next
    })

    // Surface citations as soon as their [n] markers appear in the streamed
    // text, instead of waiting for the stream to finish. The used-index set
    // only grows during a stream, so a length comparison detects changes.
    if (retrievedChunksRef.current.length > 0) {
      const used = parseUsedIndices(fullTextRef.current)
      const citations = retrievedChunksRef.current.filter((c) => used.has(c.index))
      if (citations.length > 0) {
        setCitationsMap((prev) => {
          const existing = prev.get(assistantId)
          if (existing && existing.length === citations.length) return prev
          const next = new Map(prev)
          next.set(assistantId, citations)
          return next
        })
      }
    }
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
    // request and the answer is cut off mid-stream (marked stopped).
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
        const data = await httpClient.get<{ conversation?: { messages?: StoredMessage[] } }>(
          `/api/conversations/${conversationId}`,
          { signal: controller.signal }
        )
        if (generation !== hydrationGenRef.current) return
        if (!data?.conversation) {
          setMessages([])
          setCitationsMap(new Map())
          setRetrievedChunksMap(new Map())
          setProgressMap(new Map())
          return
        }
        const stored: StoredMessage[] = data.conversation.messages ?? []
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
      // Client-seeded: the server never emits "understanding" — this step
      // covers everything before the first server progress event (network
      // round-trip, auth, history load), hence the neutral "Preparing" label.
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

      // Set when the server's `done` event arrives. The connection stays open
      // past `done` only to drain the async `title` event, so the turn is
      // finalized right there instead of waiting for the connection to close.
      let doneSeen = false

      try {
        const payload: {
          message: string
          requestId: string
          userMessageId: string
          conversationId: string
          knowledgeBaseId?: string
          model?: string
          filter?: RetrievalFilter
        } = {
          message: trimmedText,
          requestId: assistantId,
          userMessageId,
          conversationId: effectiveConvId,
        }

        if (knowledgeBaseId) {
          payload.knowledgeBaseId = knowledgeBaseId
        }

        if (selectedModel) {
          payload.model = selectedModel
        }

        if (
          retrievalFilter &&
          (retrievalFilter.fileIds?.length ||
            retrievalFilter.fileTypes?.length ||
            retrievalFilter.titleQuery)
        ) {
          payload.filter = retrievalFilter
        }

        const response = await httpClient.stream("POST", "/api/chat/stream", payload, {
          signal: controller.signal,
        })

        if (!response.body) {
          throw new Error("Empty stream response")
        }

        let streamError: string | null = null
        let firstTokenSeen = false
        let generatingSeen = false

        // idleTimeoutMs: 3 missed server keepalives (15s apart) = dead connection.
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

          if (event === "title") {
            if (
              isObject(data) &&
              typeof data.conversationId === "string" &&
              typeof data.title === "string"
            ) {
              onConversationTitleUpdated?.(data.conversationId, data.title)
            }
            return
          }

          if (event === "done") {
            doneSeen = true
            flushAssistantBuffer({ final: true })
            updateProgress(assistantId, (prev) => ({
              ...prev,
              completedAt: Date.now(),
              currentStage: "done",
            }))
            // Unlock the input and show message actions while the connection
            // drains the trailing `title` event.
            setIsLoading(false)
            setIsStreaming(false)
            return
          }

          if (event === "error") {
            streamError =
              isObject(data) && typeof data.message === "string" ? data.message : "Stream error"
          }
        }, { idleTimeoutMs: 45_000 })

        if (streamError) {
          throw new Error(streamError)
        }

        // Legacy path for streams that close without a `done` event; when
        // `done` was seen, completedAt already holds the real finish time.
        if (!doneSeen) {
          updateProgress(assistantId, (prev) => ({
            ...prev,
            completedAt: Date.now(),
            currentStage: "done",
          }))
        }
      } catch (error) {
        // An abort while draining the `title` event after `done` must not
        // re-mark an already completed turn as stopped.
        if (!doneSeen) {
          const isStopped = error instanceof DOMException && error.name === "AbortError"
          const errorMessage = error instanceof Error ? error.message : "Stream error"
          updateProgress(assistantId, (prev) => ({
            ...prev,
            completedAt: Date.now(),
            currentStage: isStopped ? "stopped" : "error",
            failedStage: getLastActiveStage(prev),
            errorMessage: isStopped ? undefined : errorMessage,
          }))
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setIsLoading(false)
        setIsStreaming(false)
      }

      if (streamBufferRef.current) {
        flushAssistantBuffer({ final: true })
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
    [appendStep, conversationId, flushAssistantBuffer, isLoading, knowledgeBaseId, onConversationTitleUpdated, retrievalFilter, scheduleFlush, scrollToBottom, selectedModel, updateProgress]
  )

  // Regenerate from a specific assistant turn. Removes the preceding user
  // message, the targeted assistant message, and every message after it from
  // both local state and the DB, then re-issues the same user query so a fresh
  // turn is appended.
  const regenerateFrom = useCallback(
    async (assistantId: string) => {
      if (isLoading || !conversationId || isRegeneratingRef.current) return

      const currentMessages = messagesRef.current
      const assistantIndex = currentMessages.findIndex(
        (m) => m.id === assistantId && m.role === "assistant"
      )
      if (assistantIndex === -1) return

      let userIndex = -1
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (currentMessages[i].role === "user") {
          userIndex = i
          break
        }
      }
      if (userIndex === -1) return

      const userText = getMessageText(currentMessages[userIndex])
      if (!userText) return

      const idsToDelete = currentMessages.slice(userIndex).map((m) => m.id)
      const idsToDeleteSet = new Set(idsToDelete)
      const assistantIdsToClear = currentMessages
        .slice(assistantIndex)
        .filter((m) => m.role === "assistant")
        .map((m) => m.id)

      isRegeneratingRef.current = true
      try {
        try {
          await httpClient.deleteWithBody(`/api/conversations/${conversationId}/messages`, {
            messageIds: idsToDelete,
          })
        } catch (err) {
          console.error("[chat-stream] regenerate: delete failed, aborting", err)
          return
        }

        setMessages((prev) => prev.filter((m) => !idsToDeleteSet.has(m.id)))
        const clearFromMap = <V,>(prev: Map<string, V>): Map<string, V> => {
          let changed = false
          const next = new Map(prev)
          for (const id of assistantIdsToClear) {
            if (next.delete(id)) changed = true
          }
          return changed ? next : prev
        }
        setProgressMap(clearFromMap)
        setCitationsMap(clearFromMap)
        setRetrievedChunksMap(clearFromMap)

        await sendMessage(userText)
      } finally {
        isRegeneratingRef.current = false
      }
    },
    [conversationId, isLoading, sendMessage]
  )

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
    regenerateFrom,
    skipNextHydration,
  }
}
