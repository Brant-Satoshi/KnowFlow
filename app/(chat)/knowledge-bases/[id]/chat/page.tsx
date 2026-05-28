"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Database, Loader2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { ChatInput } from "@/components/chat-input"
import { ChatMessages } from "@/components/chat-messages"
import { ConversationSidebar } from "@/components/conversation-sidebar"
import { EmptyState } from "@/components/empty-state"
import { FilePreviewSheet } from "@/components/file-preview-sheet"
import { KnowledgePanel } from "@/components/knowledge-panel"
import { ModelPicker } from "@/components/chat/model-picker"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useChatStream } from "@/lib/hooks/use-chat-stream"
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/llm/catalog"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useFileState } from "@/lib/hooks/use-file-state"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { PreviewContext, type OpenPreview } from "@/lib/preview-context"
import type { ConversationSummary, KnowledgeBase } from "@/lib/types"
import { cn } from "@/lib/utils"

const chatSurfaceClass =
  "border border-border bg-card shadow-[0_1px_8px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.28)]"


export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeBaseId = params.id as string

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [isKnowledgeBaseLoading, setIsKnowledgeBaseLoading] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const [mobileTab, setMobileTab] = useState<"chats" | "knowledge" | "ask">("ask")
  const scrollRef = useRef<HTMLDivElement>(null)

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(true)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CHAT_MODEL_ID)
  const creatingConversationRef = useRef(false)

  const [previewState, setPreviewState] = useState<{ fileId: string; fileName: string; chunkId?: string } | null>(null)
  const openPreview: OpenPreview = useCallback(({ fileId, fileName, chunkId }) => {
    setPreviewState({ fileId, fileName, chunkId })
  }, [])

  const { t } = useLanguage()
  const showErrorToast = useErrorToast()
  const isMobile = useIsMobile()

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth",
    })
  }, [])

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
    regenerateLast,
    skipNextHydration,
  } = useChatStream({
    knowledgeBaseId,
    conversationId: currentConversationId ?? undefined,
    selectedModel,
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
        const res = await fetch(`/api/knowledge-bases?id=${knowledgeBaseId}`)
        const json = await res.json()

        if (json.ok && json.data.knowledgeBase) {
          setKnowledgeBase(json.data.knowledgeBase)
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
        const res = await fetch(
          `/api/conversations?knowledgeBaseId=${knowledgeBaseId}`,
          { signal: controller.signal }
        )
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || t.conversationListLoadFailed)
        const list: ConversationSummary[] = json.data?.conversations ?? []
        setConversations(list)
        if (list.length > 0) {
          setCurrentConversationId(list[0].id)
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return
        console.error("Failed to load conversations:", err)
        showErrorToast(t.conversationListLoadFailed)
      } finally {
        setConversationsLoading(false)
      }
    }
    void load()

    return () => {
      controller.abort()
    }
  }, [knowledgeBaseId, showErrorToast, t.conversationListLoadFailed])

  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (currentConversationId) return currentConversationId
    if (creatingConversationRef.current) return null
    creatingConversationRef.current = true
    setCreatingConversation(true)
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgeBaseId }),
      })
      const json = await res.json()
      if (!json.ok || !json.data?.conversation) {
        throw new Error(json.error || t.conversationCreateFailed)
      }
      const created: ConversationSummary = json.data.conversation
      setConversations((prev) => [created, ...prev])
      skipNextHydration()
      setCurrentConversationId(created.id)
      return created.id
    } catch (err) {
      console.error("Failed to create conversation:", err)
      showErrorToast(t.conversationCreateFailed)
      return null
    } finally {
      creatingConversationRef.current = false
      setCreatingConversation(false)
    }
  }, [currentConversationId, knowledgeBaseId, skipNextHydration, showErrorToast, t.conversationCreateFailed])

  const handleSelectConversation = useCallback(
    (id: string) => {
      setCurrentConversationId(id)
      if (isMobile) setMobileTab("ask")
    },
    [isMobile]
  )

  const handleRenameConversation = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        })
        const json = await res.json()
        if (!json.ok || !json.data?.conversation) {
          throw new Error(json.error || t.conversationRenameFailed)
        }
        const updated: ConversationSummary = json.data.conversation
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
        setCurrentConversationId(next[0]?.id ?? null)
      }

      fetch(`/api/conversations/${id}`, { method: "DELETE" })
        .then((res) => res.json())
        .then((json) => {
          if (!json.ok) throw new Error(json.error || t.conversationDeleteFailed)
        })
        .catch((err) => {
          console.error("Failed to delete conversation:", err)
          setConversations(snapshot)
          if (wasActive) setCurrentConversationId(id)
          showErrorToast(t.conversationDeleteFailed)
        })

      return true
    },
    [conversations, currentConversationId, showErrorToast, t.conversationDeleteFailed]
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

  if (isMobile) {
    return (
      <PreviewContext.Provider value={openPreview}>
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
        <div className="home-orb-float pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-[#C49A2E]/6 blur-3xl dark:bg-[#C49A2E]/8" />
        <div className="home-orb-float pointer-events-none absolute -right-12 top-32 h-72 w-72 rounded-full bg-[#4A8A5C]/5 blur-3xl dark:bg-[#4A8A5C]/8 [animation-delay:-5s]" />

        <div className="relative flex min-h-0 flex-1 flex-col">
          <header className={cn("px-4 py-3", chatSurfaceClass)}>
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="min-w-0">
                <BrandLogo
                  name={knowledgeBase?.name || t.title}
                  className="min-w-0"
                  textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
                />
              </Link>
              <div className="flex items-center gap-2">
                <ModelPicker
                  value={selectedModel}
                  onChange={setSelectedModel}
                  disabled={isStreaming}
                  ariaLabel={t.modelPicker}
                  triggerClassName="h-9 w-[150px] cursor-pointer"
                />
                <SettingsMenu />
              </div>
            </div>
          </header>

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
                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
                >
                  {isHydrating && !hasMessages ? (
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : hasMessages ? (
                    <div className="px-4 py-5">
                      <ChatMessages
                        messages={messages}
                        isLoading={isLoading}
                        isStreaming={isStreaming}
                        citationsMap={citationsMap}
                        retrievedChunksMap={retrievedChunksMap}
                        progressMap={progressMap}
                        onRegenerate={regenerateLast}
                      />
                    </div>
                  ) : (
                    <EmptyState
                      hasKnowledge={hasKnowledge}
                      isPreparingKnowledge={isParsingOrUploading}
                      onSuggestionClick={handleSuggestionClick}
                      onUpload={handleUpload}
                    />
                  )}
                </div>

                <ChatInput
                  input={input}
                  onChange={setInput}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                  isLoading={isLoading}
                  hasKnowledge={hasKnowledge}
                  isPreparingKnowledge={isParsingOrUploading}
                />
              </section>
            </TabsContent>

            <TabsContent value="knowledge" className="-mt-px flex min-h-0 flex-1 overflow-hidden">
              <KnowledgePanel
                files={files}
                onUpload={handleUpload}
                onParse={handleParse}
                onDelete={handleDelete}
                parsingIds={parsingIds}
                uploading={uploading}
                collapsed={false}
                initialLoading={isInitialLoading}
                onToggle={() => undefined}
                fullWidth={true}
                className="rounded-none"
              />
            </TabsContent>

            <TabsContent value="chats" className="-mt-px flex min-h-0 flex-1 overflow-hidden">
              <ConversationSidebar
                conversations={conversations}
                currentId={currentConversationId}
                isLoading={conversationsLoading}
                isCreating={creatingConversation}
                onSelect={handleSelectConversation}
                onCreate={() => { setCurrentConversationId(null); setInput("") }}
                onRename={handleRenameConversation}
                onDelete={handleDeleteConversation}
                fullWidth
                className="rounded-none"
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <FilePreviewSheet
        open={previewState !== null}
        fileId={previewState?.fileId ?? null}
        fileName={previewState?.fileName ?? null}
        chunkId={previewState?.chunkId}
        onOpenChange={(next) => { if (!next) setPreviewState(null) }}
      />
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
        <header className={cn("px-4 py-3 sm:px-5", chatSurfaceClass)}>
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="min-w-0">
              <BrandLogo
                name={knowledgeBase?.name || t.title}
                className="min-w-0"
                textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
              />
            </Link>
            <div className="flex items-center gap-3">
              <ModelPicker
                value={selectedModel}
                onChange={setSelectedModel}
                disabled={isStreaming}
                ariaLabel={t.modelPicker}
              />
              <SettingsMenu />
            </div>
          </div>
        </header>

        <div className="-mt-px flex min-h-0 min-w-0 flex-1">
          <ConversationSidebar
            conversations={conversations}
            currentId={currentConversationId}
            isLoading={conversationsLoading}
            isCreating={creatingConversation}
            onSelect={handleSelectConversation}
            onCreate={() => { setCurrentConversationId(null); setInput("") }}
            onRename={handleRenameConversation}
            onDelete={handleDeleteConversation}
            className="rounded-none"
          />

          <section className={cn("-ml-px flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none", chatSurfaceClass)}>
            <div className="min-h-0 flex-1">
              {isHydrating && !hasMessages ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : hasMessages ? (
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overscroll-contain px-5 py-6 [-webkit-overflow-scrolling:touch] sm:px-6"
                >
                  <div className="mx-auto max-w-5xl">
                    <ChatMessages
                      messages={messages}
                      isLoading={isLoading}
                      isStreaming={isStreaming}
                      citationsMap={citationsMap}
                      retrievedChunksMap={retrievedChunksMap}
                      progressMap={progressMap}
                      onRegenerate={regenerateLast}
                    />
                  </div>
                </div>
              ) : (
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overscroll-contain px-1 [-webkit-overflow-scrolling:touch] sm:px-2"
                >
                  <EmptyState
                    hasKnowledge={hasKnowledge}
                    isPreparingKnowledge={isParsingOrUploading}
                    onSuggestionClick={handleSuggestionClick}
                    onUpload={handleUpload}
                  />
                </div>
              )}
            </div>

            <ChatInput
              input={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              onStop={handleStop}
              isLoading={isLoading}
              hasKnowledge={hasKnowledge}
              isPreparingKnowledge={isParsingOrUploading}
            />
          </section>

          <KnowledgePanel
            files={files}
            onUpload={handleUpload}
            onParse={handleParse}
            onDelete={handleDelete}
            parsingIds={parsingIds}
            uploading={uploading}
            collapsed={panelCollapsed}
            initialLoading={isInitialLoading}
            onToggle={() => setPanelCollapsed((prev) => !prev)}
            side="right"
            className="-ml-px rounded-none"
          />
        </div>
      </div>
    </div>
    <FilePreviewSheet
      open={previewState !== null}
      fileId={previewState?.fileId ?? null}
      fileName={previewState?.fileName ?? null}
      chunkId={previewState?.chunkId}
      onOpenChange={(next) => { if (!next) setPreviewState(null) }}
    />
    </PreviewContext.Provider>
  )
}
