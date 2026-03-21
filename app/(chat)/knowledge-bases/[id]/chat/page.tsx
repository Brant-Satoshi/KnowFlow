"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import type { UIMessage } from "ai"
import { KnowledgePanel } from "@/components/knowledge-panel"
import { ChatMessages } from "@/components/chat-messages"
import { ChatInput } from "@/components/chat-input"
import { EmptyState } from "@/components/empty-state"
import { SettingsMenu } from "@/components/settings-menu"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/components/ui/use-mobile"
import { FileDoc, KnowledgeBase } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Database } from "lucide-react"
import { readSseStream } from "@/lib/chat/sse"
import Link from "next/link"

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

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeBaseId = params.id as string

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [files, setFiles] = useState<FileDoc[]>([])
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set())
  const [mobileTab, setMobileTab] = useState<"knowledge" | "ask">("ask")
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const streamBufferRef = useRef("")
  const flushRafRef = useRef<number | null>(null)
  const streamingAssistantIdRef = useRef<string | null>(null)

  const { t } = useLanguage()
  const showErrorToast = useErrorToast()
  const isMobile = useIsMobile()

  // Fetch knowledge base details
  useEffect(() => {
    if (!knowledgeBaseId) {
      setIsInitialLoading(false)
      return
    }

    const fetchKnowledgeBase = async () => {
      try {
        const res = await fetch(`/api/knowledge-bases?id=${knowledgeBaseId}`)
        const json = await res.json()
        if (json.ok && json.data.knowledgeBase) {
          setKnowledgeBase(json.data.knowledgeBase)
        } else {
          showErrorToast(t.knowledgeBaseNotFound)
          router.push("/")
        }
      } catch (e) {
        console.error("Failed to fetch knowledge base:", e)
        showErrorToast(t.failedToLoadKnowledgeBase)
        router.push("/")
      }
    }

    fetchKnowledgeBase()
  }, [t, knowledgeBaseId, router, showErrorToast])

  const flushAssistantBuffer = useCallback(() => {
    const assistantId = streamingAssistantIdRef.current
    const delta = streamBufferRef.current

    if (!assistantId || !delta) {
      flushRafRef.current = null
      return
    }

    streamBufferRef.current = ""
    setMessages((prev) => {
      const next = [...prev]
      const assistantIndex = next.findIndex((message) => message.id === assistantId)
      if (assistantIndex === -1) return next

      const current = next[assistantIndex]
      const mergedText = `${getMessageText(current)}${delta}`
      next[assistantIndex] = createTextMessage("assistant", mergedText, assistantId)
      return next
    })
    flushRafRef.current = null
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current != null) return

    flushRafRef.current = requestAnimationFrame(() => {
      flushAssistantBuffer()
    })
  }, [flushAssistantBuffer])

  // Fetch files for the current knowledge base
  const fetchFiles = useCallback(async () => {
    if (!knowledgeBaseId) {
      setIsInitialLoading(false)
      return
    }

    try {
      const url = `/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`
      const res = await fetch(url)
      const json = await res.json()
      if (json.ok) {
        setFiles(json.data.files)
      }
    } catch (e) {
      console.error("Failed to fetch files:", e)
    } finally {
      setIsInitialLoading(false)
    }
  }, [knowledgeBaseId])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

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

  const handleUpload = useCallback(async (file: File) => {
    if (!knowledgeBaseId) {
      showErrorToast(t.noKnowledgeBaseSelected)
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("knowledgeBaseId", knowledgeBaseId)

      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      })
      const json = await res.json()
      if (json.ok) {
        setFiles((prev) => [...prev, json.data.file])
      } else {
        showErrorToast(json.error || t.uploadFailed)
      }
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : t.uploadFailed)
    } finally {
      setUploading(false)
    }
  }, [knowledgeBaseId, showErrorToast, t])

  const handleParse = useCallback(async (id: string) => {
    setParsingIds((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/files/${id}/parse`, { method: "POST" })
      const json = await res.json()
      if (json.ok && json.data?.file) {
        setFiles((prev) => prev.map((f) => (f.id === id ? json.data.file : f)))
      } else {
        showErrorToast(json.error || t.parseFailed)
        // Refresh files
        const url = `/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId || "")}`
        const refreshRes = await fetch(url)
        const refreshJson = await refreshRes.json()
        if (refreshJson.ok) {
          setFiles(refreshJson.data.files)
        }
      }
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : t.parseFailed)
      // Refresh files
      if (knowledgeBaseId) {
        const url = `/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`
        const res = await fetch(url)
        const json = await res.json()
        if (json.ok) {
          setFiles(json.data.files)
        }
      }
    } finally {
      setParsingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [knowledgeBaseId, t, showErrorToast])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/files/${id}`, { method: "DELETE" })
      const json = await res.json()
      if (json.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== id))
      } else {
        showErrorToast(json.error || t.deleteFailed)
      }
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : t.deleteFailed)
    }
  }, [t, showErrorToast])

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
        setIsStreaming(false)
      }
      if (streamBufferRef.current) {
        flushAssistantBuffer()
      }
    },
    [flushAssistantBuffer, isLoading, knowledgeBaseId, scheduleFlush]
  )

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

  const hasFiles = files.length > 0
  const isParsingOrUploading = uploading || parsingIds.size > 0
  const hasKnowledge = hasFiles && !isParsingOrUploading
  const indexedFilesCount = files.filter((f) => f.status === "indexed").length
  const hasMessages = messages.length > 0

  // No knowledge base selected
  if (!knowledgeBaseId) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-[var(--chat-page-bg)] px-6">
        <div className="text-center">
          <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold text-foreground">Select a Knowledge Base</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Please select a knowledge base from the home page to start chatting
          </p>
          <Link href="/">
            <Button className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  // Loading state
  if (isInitialLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--chat-page-bg)]">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    )
  }

  // Mobile layout with tabs
  if (isMobile) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--chat-page-bg)]">
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "knowledge" | "ask")}
          className="flex flex-1 flex-col"
        >
          <TabsList className="w-full justify-start rounded-none border-b bg-card px-4 pt-2">
            <TabsTrigger value="knowledge" className="flex-1">
              {t.knowledge}
            </TabsTrigger>
            <TabsTrigger value="ask" className="flex-1">
              {t.ask}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="knowledge" className="flex-1 mt-0 overflow-hidden p-4">
            <KnowledgePanel
              files={files}
              onUpload={handleUpload}
              onParse={handleParse}
              onDelete={handleDelete}
              parsingIds={parsingIds}
              uploading={uploading}
              collapsed={false}
              initialLoading={isInitialLoading}
              onToggle={() => { }}
              fullWidth={true}
            />
          </TabsContent>

          <TabsContent value="ask" className="flex-1 mt-0 flex flex-col overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden bg-card rounded-t-2xl mt-2 border border-border">
              <header className="flex items-center justify-between border-b chat-surface-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-semibold text-foreground">{knowledgeBase?.name || t.title}</h1>
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                    RAG
                  </span>
                </div>
                <SettingsMenu />
              </header>

              {hasMessages ? (
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                  <div className="mx-auto max-w-4xl">
                    <ChatMessages isStreaming={isStreaming} messages={messages} isLoading={isLoading} />
                  </div>
                </div>
              ) : (
                <EmptyState hasKnowledge={hasKnowledge} onSuggestionClick={handleSuggestionClick} />
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
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  // Desktop layout
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--chat-page-bg)] px-6 py-9">
      <KnowledgePanel
        files={files}
        onUpload={handleUpload}
        onParse={handleParse}
        onDelete={handleDelete}
        parsingIds={parsingIds}
        uploading={uploading}
        collapsed={panelCollapsed}
        initialLoading={isInitialLoading}
        onToggle={() => setPanelCollapsed((p) => !p)}
      />

      <div className="flex flex-1 flex-col overflow-hidden bg-card my-4 ml-6 rounded-2xl border border-border">
        <header className="flex items-center justify-between border-b chat-surface-border px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground">{knowledgeBase?.name || t.title}</h1>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium uppercase tracking-wider text-primary">
              RAG
            </span>
          </div>
          <div className="flex items-center gap-3">
            {hasFiles && (
              <span className="text-xs text-muted-foreground">
                {indexedFilesCount} / {files.length} {t.filesIndexed}
              </span>
            )}
            <SettingsMenu />
          </div>
        </header>

        {hasMessages ? (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-4xl">
              <ChatMessages  isStreaming={isStreaming} messages={messages} isLoading={isLoading} />
            </div>
          </div>
        ) : (
          <EmptyState hasKnowledge={hasKnowledge} onSuggestionClick={handleSuggestionClick} />
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
