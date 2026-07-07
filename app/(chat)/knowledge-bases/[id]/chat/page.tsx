"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowLeft, Database, FlaskConical, Loader2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { ChatInput } from "@/components/chat/chat-input"
import { ConversationSidebar } from "@/components/chat/conversation-sidebar"
import { EmptyState } from "@/components/empty-state"
import { KnowledgePanel } from "@/components/chat/knowledge-panel"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/components/ui/use-mobile"
import { httpClient } from "@/lib/http/client"
import { useChatStream } from "@/lib/hooks/use-chat-stream"
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/llm/catalog"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useFileState } from "@/lib/hooks/use-file-state"
import { useScrollToBottom } from "@/lib/hooks/use-scroll-to-bottom"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { PreviewContext, type OpenPreview } from "@/lib/preview-context"
import type { ConversationSummary, KnowledgeBase, RetrievalFilter } from "@/lib/types"
import { cn } from "@/lib/utils"

const chatSurfaceClass =
  "border border-border bg-card shadow-[0_1px_8px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.28)]"

// Loaded on demand: both pull in the markdown rendering chain (react-markdown +
// remark/rehype), which an empty conversation never needs — keeping them out of
// the initial bundle cuts the mobile LCP on this fully client-rendered page.
const ChatMessages = dynamic(
  () => import("@/components/chat/chat-messages").then((m) => m.ChatMessages),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)
const FilePreviewSheet = dynamic(
  () => import("@/components/chat/file-preview-sheet").then((m) => m.FilePreviewSheet),
  { ssr: false }
)


export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const knowledgeBaseId = params.id as string

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [isKnowledgeBaseLoading, setIsKnowledgeBaseLoading] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const [mobileTab, setMobileTab] = useState<"chats" | "knowledge" | "ask">("ask")
  const { containerRef: scrollRef, setContainerRef, scrollToBottom, isAtBottom } = useScrollToBottom()

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CHAT_MODEL_ID)
  // Per-session retrieval filter; not persisted, resets with the per-KB page remount.
  const [retrievalFilter, setRetrievalFilter] = useState<RetrievalFilter>({})
  const creatingConversationRef = useRef(false)
  // Guards rapid model switches: only the latest PUT may roll the UI back, and
  // each new selection aborts the prior in-flight update.
  const modelUpdateSeqRef = useRef(0)
  const modelUpdateAbortRef = useRef<AbortController | null>(null)
  // Deep-link target from ?chatid, consumed once on the first conversation load.
  const pendingChatIdRef = useRef<string | null>(searchParams.get("chatid"))

  const [previewState, setPreviewState] = useState<{ fileId: string; fileName: string; chunkId?: string } | null>(null)
  const previewEverOpenedRef = useRef(false)
  const openPreview: OpenPreview = useCallback(({ fileId, fileName, chunkId }) => {
    setPreviewState({ fileId, fileName, chunkId })
  }, [])

  const { t } = useLanguage()
  const showErrorToast = useErrorToast()
  const isMobile = useIsMobile()

  const {
    files,
    uploading,
    parsingIds,
    isInitialLoading: isFilesLoading,
    handleUpload,
    handleParse,
    handleDelete,
  } = useFileState({
    knowledgeBaseId,
    showErrorToast,
    noKnowledgeBaseSelectedMessage: t.noKnowledgeBaseSelected,
    uploadFailedMessage: t.uploadFailed,
    parseFailedMessage: t.parseFailed,
    deleteFailedTitle: t.deleteFailedTitle,
    deleteFailedDesc: t.deleteFailedDesc,
  })

  const {
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
  } = useChatStream({
    knowledgeBaseId,
    conversationId: currentConversationId ?? undefined,
    selectedModel,
    retrievalFilter,
    scrollRef,
    scrollToBottom,
    onConversationTitleUpdated: useCallback((id: string, title: string) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      )
    }, []),
  })

  // Sync model picker once per conversation switch. Reading `conversations` here is intentional;
  // we don't want subsequent `conversations` mutations (rename / title update) to clobber a model
  // the user just picked in the dropdown.
  useEffect(() => {
    if (!currentConversationId) {
      setSelectedModel(DEFAULT_CHAT_MODEL_ID)
      return
    }
    const conv = conversations.find((c) => c.id === currentConversationId)
    setSelectedModel(conv?.model ?? DEFAULT_CHAT_MODEL_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConversationId])

  useEffect(() => {
    if (!knowledgeBaseId) {
      setIsKnowledgeBaseLoading(false)
      return
    }

    setIsKnowledgeBaseLoading(true)

    const fetchKnowledgeBase = async () => {
      try {
        const data = await httpClient.get<{ knowledgeBase: KnowledgeBase }>(
          `/api/knowledge-bases?id=${knowledgeBaseId}`
        )

        if (data.knowledgeBase) {
          setKnowledgeBase(data.knowledgeBase)
        } else {
          showErrorToast(t.knowledgeBaseNotFound)
          router.push("/")
        }
      } catch (error) {
        console.error("Failed to fetch knowledge base:", error)
        showErrorToast(t.failedToLoadKnowledgeBase)
        router.push("/")
      } finally {
        setIsKnowledgeBaseLoading(false)
      }
    }

    void fetchKnowledgeBase()
  }, [knowledgeBaseId, router, showErrorToast, t.failedToLoadKnowledgeBase, t.knowledgeBaseNotFound])

  useEffect(() => {
    if (!knowledgeBaseId) return

    setConversationsLoading(true)
    setCurrentConversationId(null)

    const controller = new AbortController()
    const load = async () => {
      try {
        const data = await httpClient.get<{ conversations?: ConversationSummary[] }>(
          `/api/conversations?knowledgeBaseId=${knowledgeBaseId}`,
          { signal: controller.signal }
        )
        const list: ConversationSummary[] = data?.conversations ?? []
        setConversations(list)
        if (list.length > 0) {
          const requested = pendingChatIdRef.current
          pendingChatIdRef.current = null
          setCurrentConversationId(
            requested && list.some((c) => c.id === requested) ? requested : list[0].id
          )
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return
        console.error("Failed to load conversations:", err)
        showErrorToast(t.conversationListLoadFailed)
      } finally {
        // Skip if this run was aborted (KB switched) — a newer load owns the
        // loading state now and we must not clear its spinner.
        if (!controller.signal.aborted) setConversationsLoading(false)
      }
    }
    void load()

    return () => {
      controller.abort()
    }
  }, [knowledgeBaseId, showErrorToast, t.conversationListLoadFailed])

  const syncChatIdToUrl = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (id) next.set("chatid", id)
      else next.delete("chatid")
      const query = next.toString()
      const base = `/knowledge-bases/${knowledgeBaseId}/chat`
      router.replace(query ? `${base}?${query}` : base, { scroll: false })
    },
    [router, searchParams, knowledgeBaseId]
  )

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (currentConversationId) return currentConversationId
    if (creatingConversationRef.current) return null
    creatingConversationRef.current = true
    setCreatingConversation(true)
    try {
      const data = await httpClient.post<{ conversation: ConversationSummary }>(
        "/api/conversations",
        { knowledgeBaseId }
      )
      if (!data?.conversation) {
        throw new Error(t.conversationCreateFailed)
      }
      const created: ConversationSummary = data.conversation
      setConversations((prev) => [created, ...prev])
      skipNextHydration()
      setCurrentConversationId(created.id)
      syncChatIdToUrl(created.id)
      return created.id
    } catch (err) {
      console.error("Failed to create conversation:", err)
      showErrorToast(t.conversationCreateFailed)
      return null
    } finally {
      creatingConversationRef.current = false
      setCreatingConversation(false)
    }
  }, [currentConversationId, knowledgeBaseId, skipNextHydration, syncChatIdToUrl, showErrorToast, t.conversationCreateFailed])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setCurrentConversationId(id)
      syncChatIdToUrl(id)
      if (isMobile) setMobileTab("ask")
    },
    [isMobile, syncChatIdToUrl]
  )

  const handleNewConversation = useCallback(() => {
    setCurrentConversationId(null)
    setInput("")
    syncChatIdToUrl(null)
  }, [syncChatIdToUrl])

  const handleRenameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const data = await httpClient.put<{ conversation: ConversationSummary }>(
          `/api/conversations/${id}`,
          { title }
        )
        if (!data?.conversation) {
          throw new Error(t.conversationRenameFailed)
        }
        const updated: ConversationSummary = data.conversation
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, title: updated.title, updatedAt: updated.updatedAt } : c
          )
        )
        return true
      } catch (err) {
        console.error("Failed to rename conversation:", err)
        showErrorToast(t.conversationRenameFailed)
        return false
      }
    },
    [showErrorToast, t.conversationRenameFailed]
  )

  const handleModelChange = useCallback(
    (modelId: string) => {
      const convId = currentConversationId
      const prevModel = selectedModel
      setSelectedModel(modelId)
      if (!convId) return
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, model: modelId } : c))
      )
      // Abort any earlier in-flight update so an older PUT can't land on the
      // server after this one, and tag this request with a sequence number.
      modelUpdateAbortRef.current?.abort()
      const controller = new AbortController()
      modelUpdateAbortRef.current = controller
      const seq = ++modelUpdateSeqRef.current
      void httpClient
        .put(`/api/conversations/${convId}`, { model: modelId }, { signal: controller.signal })
        .catch((err) => {
          // A newer selection has superseded this request: its abort (or a
          // stale late failure) must not clobber the user's current choice.
          if (seq !== modelUpdateSeqRef.current) return
          if (err instanceof DOMException && err.name === "AbortError") return
          console.error("Failed to persist model selection:", err)
          // Roll back the optimistic selection so the UI reflects the
          // still-persisted model instead of silently diverging.
          setSelectedModel(prevModel)
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, model: prevModel } : c))
          )
          showErrorToast(t.modelUpdateFailed)
        })
    },
    [currentConversationId, selectedModel, showErrorToast, t.modelUpdateFailed]
  )

  const handleDeleteConversation = useCallback(
    async (id: string): Promise<boolean> => {
      const wasActive = currentConversationId === id
      let snapshot: ConversationSummary[] = []

      setConversations((prev) => {
        snapshot = [...prev]
        return prev.filter((c) => c.id !== id)
      })
      if (wasActive) {
        const next = conversations.filter((c) => c.id !== id)
        const nextId = next[0]?.id ?? null
        setCurrentConversationId(nextId)
        syncChatIdToUrl(nextId)
      }

      httpClient
        .delete(`/api/conversations/${id}`)
        .catch((err) => {
          console.error("Failed to delete conversation:", err)
          setConversations(snapshot)
          if (wasActive) {
            setCurrentConversationId(id)
            syncChatIdToUrl(id)
          }
          showErrorToast(t.conversationDeleteFailed)
        })

      return true
    },
    [conversations, currentConversationId, syncChatIdToUrl, showErrorToast, t.conversationDeleteFailed]
  )

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || isLoading || creatingConversationRef.current) return
    const nextInput = input
    const convId = await ensureConversation()
    if (!convId) return
    setInput("")
    void sendMessage(nextInput, convId)
  }, [ensureConversation, input, isLoading, sendMessage])

  const handleSuggestionClick = useCallback(
    async (text: string) => {
      if (isLoading || creatingConversationRef.current) return
      const convId = await ensureConversation()
      if (!convId) return
      void sendMessage(text, convId)
    },
    [ensureConversation, isLoading, sendMessage]
  )

  const isInitialLoading = isKnowledgeBaseLoading || isFilesLoading || conversationsLoading
  const isParsingOrUploading = uploading || parsingIds.size > 0
  const hasKnowledge = files.some((file) => file.status === "indexed")
  const hasMessages = messages.length > 0

  const scrollDownButton =
    hasMessages && !isAtBottom ? (
      <button
        type="button"
        onClick={() => scrollToBottom()}
        aria-label={t.scrollToBottom}
        className="absolute bottom-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition hover:bg-accent"
      >
        <ArrowDown className="h-5 w-5" />
      </button>
    ) : null

  if (!knowledgeBaseId) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-10">
        <div className={cn("relative w-full max-w-xl rounded-[1.25rem] p-8 text-center", chatSurfaceClass)}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-black/4 dark:bg-white/6">
            <Database className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-foreground">{t.selectKnowledgeBaseTitle}</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{t.selectKnowledgeBaseDesc}</p>
          <Button asChild className="mt-6 rounded-xl px-5">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              {t.goToHome}
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  if (isInitialLoading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-10">
        <div className={cn("relative flex w-full max-w-sm flex-col items-center rounded-[1.25rem] p-8 text-center", chatSurfaceClass)}>
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-black/4 dark:bg-white/6">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-foreground">
            {t.pageLoadingTitle}
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            {t.pageLoadingDesc}
          </p>
        </div>
      </div>
    )
  }

  // Shared between the mobile and desktop layouts below — the two branches
  // differ only in their responsive wrappers, not in what they mount.
  const chatHeader = (
    <header className={cn("flex h-13 items-center px-4 sm:px-5", chatSurfaceClass)}>
      <div className="flex w-full items-center justify-between gap-4">
        <Link href="/" className="min-w-0">
          <BrandLogo
            name={knowledgeBase?.name || t.title}
            className="min-w-0"
            textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
          />
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-full">
            <Link href="/eval" aria-label={t.evalEntry}>
              <FlaskConical className="h-4 w-4" />
            </Link>
          </Button>
          <SettingsMenu />
        </div>
      </div>
    </header>
  )

  const chatMessagesEl = (
    <ChatMessages
      messages={messages}
      isLoading={isLoading}
      isStreaming={isStreaming}
      citationsMap={citationsMap}
      retrievedChunksMap={retrievedChunksMap}
      progressMap={progressMap}
      onRegenerate={regenerateFrom}
    />
  )

  const emptyStateEl = (
    <EmptyState
      hasKnowledge={hasKnowledge}
      isPreparingKnowledge={isParsingOrUploading}
      onSuggestionClick={handleSuggestionClick}
      onUpload={handleUpload}
    />
  )

  const chatInputEl = (
    <ChatInput
      input={input}
      onChange={setInput}
      onSubmit={handleSubmit}
      onStop={handleStop}
      isLoading={isLoading}
      hasKnowledge={hasKnowledge}
      isPreparingKnowledge={isParsingOrUploading}
      selectedModel={selectedModel}
      onModelChange={handleModelChange}
      isModelDisabled={isStreaming}
      files={files}
      retrievalFilter={retrievalFilter}
      onRetrievalFilterChange={setRetrievalFilter}
    />
  )

  const conversationSidebarProps = {
    conversations,
    currentId: currentConversationId,
    isLoading: conversationsLoading,
    isCreating: creatingConversation,
    onSelect: handleSelectConversation,
    onCreate: handleNewConversation,
    onRename: handleRenameConversation,
    onDelete: handleDeleteConversation,
  }

  const knowledgePanelProps = {
    files,
    onUpload: handleUpload,
    onParse: handleParse,
    onDelete: handleDelete,
    parsingIds,
    uploading,
    initialLoading: isInitialLoading,
  }

  // Mount the (dynamically imported) sheet only once a preview has been
  // requested — mounting it eagerly would pull its markdown chunk into the
  // initial page load. Kept mounted afterwards so the close animation plays.
  if (previewState !== null) previewEverOpenedRef.current = true
  const filePreviewEl = previewEverOpenedRef.current ? (
    <FilePreviewSheet
      open={previewState !== null}
      fileId={previewState?.fileId ?? null}
      fileName={previewState?.fileName ?? null}
      chunkId={previewState?.chunkId}
      onOpenChange={(next) => { if (!next) setPreviewState(null) }}
    />
  ) : null

  if (isMobile) {
    return (
      <PreviewContext.Provider value={openPreview}>
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
        <div className="home-orb-float pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-[#C49A2E]/6 blur-3xl dark:bg-[#C49A2E]/8" />
        <div className="home-orb-float pointer-events-none absolute -right-12 top-32 h-72 w-72 rounded-full bg-[#4A8A5C]/5 blur-3xl dark:bg-[#4A8A5C]/8 [animation-delay:-5s]" />

        <div className="relative flex min-h-0 flex-1 flex-col">
          {chatHeader}

          <Tabs
            value={mobileTab}
            onValueChange={(value) => setMobileTab(value as "chats" | "knowledge" | "ask")}
            className="-mt-px flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TabsList className={cn("h-auto rounded-none p-1", chatSurfaceClass)}>
              <TabsTrigger
                value="chats"
                className="flex-1 rounded-[0.85rem] py-2.5 data-[state=active]:shadow-none"
              >
                {t.chatsTab}
              </TabsTrigger>
              <TabsTrigger
                value="knowledge"
                className="flex-1 rounded-[0.85rem] py-2.5 data-[state=active]:shadow-none"
              >
                {t.knowledge}
              </TabsTrigger>
              <TabsTrigger
                value="ask"
                className="flex-1 rounded-[0.85rem] py-2.5 data-[state=active]:shadow-none"
              >
                {t.ask}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ask" className="-mt-px flex min-h-0 flex-1 flex-col overflow-hidden">
              <section className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", chatSurfaceClass)}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                  ref={setContainerRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
                >
                  {isHydrating && !hasMessages ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : hasMessages ? (
                    <div className="px-4 py-5">{chatMessagesEl}</div>
                  ) : (
                    emptyStateEl
                  )}
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-card to-transparent"
                />
                {scrollDownButton}
                </div>

                {chatInputEl}
              </section>
            </TabsContent>

            <TabsContent value="knowledge" className="-mt-px flex min-h-0 flex-1 overflow-hidden">
              <KnowledgePanel
                {...knowledgePanelProps}
                collapsed={false}
                onToggle={() => undefined}
                fullWidth={true}
                className="rounded-none"
              />
            </TabsContent>

            <TabsContent value="chats" className="-mt-px flex min-h-0 flex-1 overflow-hidden">
              <ConversationSidebar
                {...conversationSidebarProps}
                fullWidth
                className="rounded-none"
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      {filePreviewEl}
      </PreviewContext.Provider>
    )
  }

  return (
    <PreviewContext.Provider value={openPreview}>
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <div className="home-orb-float pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-[#C49A2E]/6 blur-3xl dark:bg-[#C49A2E]/8" />
      <div className="home-orb-float pointer-events-none absolute -right-16 top-24 h-96 w-96 rounded-full bg-[#4A8A5C]/5 blur-3xl dark:bg-[#4A8A5C]/8 [animation-delay:-6s]" />
      <div className="home-orb-float pointer-events-none absolute -bottom-28 left-1/3 h-80 w-80 rounded-full bg-[#C05B3C]/4 blur-3xl dark:bg-[#C05B3C]/6 [animation-delay:-9s]" />

      <div className="relative flex min-h-0 w-full flex-1 flex-col">
        {chatHeader}

        <div className="-mt-px flex min-h-0 min-w-0 flex-1">
          <ConversationSidebar {...conversationSidebarProps} className="rounded-none" />

          <section className={cn("-ml-px flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none", chatSurfaceClass)}>
            <div className="relative min-h-0 flex-1">
              {isHydrating && !hasMessages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : hasMessages ? (
                <div
                  ref={setContainerRef}
                  className="h-full overflow-y-auto overscroll-contain px-4 py-6 [-webkit-overflow-scrolling:touch] sm:px-6"
                >
                  <div className="mx-auto max-w-3xl w-full">{chatMessagesEl}</div>
                </div>
              ) : (
                <div
                  ref={setContainerRef}
                  className="h-full overflow-y-auto overscroll-contain px-1 [-webkit-overflow-scrolling:touch] sm:px-2"
                >
                  {emptyStateEl}
                </div>
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-card to-transparent"
              />
              {scrollDownButton}
            </div>

            {chatInputEl}
          </section>

          <KnowledgePanel
            {...knowledgePanelProps}
            collapsed={panelCollapsed}
            onToggle={() => setPanelCollapsed((prev) => !prev)}
            side="right"
            className="-ml-px rounded-none"
          />
        </div>
      </div>
    </div>
    {filePreviewEl}
    </PreviewContext.Provider>
  )
}
