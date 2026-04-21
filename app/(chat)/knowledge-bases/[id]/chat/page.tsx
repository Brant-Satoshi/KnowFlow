"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Database, Loader2, Sparkles } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { ChatInput } from "@/components/chat-input"
import { ChatMessages } from "@/components/chat-messages"
import { EmptyState } from "@/components/empty-state"
import { KnowledgePanel } from "@/components/knowledge-panel"
import { SettingsMenu } from "@/components/settings-menu"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useChatStream } from "@/lib/hooks/use-chat-stream"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useFileState } from "@/lib/hooks/use-file-state"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { KnowledgeBase } from "@/lib/types"
import { cn } from "@/lib/utils"

const chatSurfaceClass =
  "border border-white/60 bg-white/76 shadow-[0_30px_80px_-48px_rgba(19,31,56,0.34)] backdrop-blur-xl dark:border-white/10 dark:bg-[#10161d]/84 dark:shadow-[0_30px_80px_-48px_rgba(0,0,0,0.92)]"


export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeBaseId = params.id as string

  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [isKnowledgeBaseLoading, setIsKnowledgeBaseLoading] = useState(true)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [input, setInput] = useState("")
  const [mobileTab, setMobileTab] = useState<"knowledge" | "ask">("ask")
  const scrollRef = useRef<HTMLDivElement>(null)

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
    deletingIds,
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
    deleteLoadingTitle: t.deleteLoadingTitle,
    deleteLoadingDesc: t.deleteLoadingDesc,
    deleteSuccessTitle: t.deleteSuccessTitle,
    deleteSuccessDesc: t.deleteSuccessDesc,
  })

  const { messages, isLoading, isStreaming, citationsMap, handleStop, sendMessage } = useChatStream({
    knowledgeBaseId,
    scrollRef,
    scrollToBottom,
  })

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

  const isInitialLoading = isKnowledgeBaseLoading || isFilesLoading
  const isParsingOrUploading = uploading || parsingIds.size > 0
  const hasKnowledge = files.some((file) => file.status === "indexed") && !isParsingOrUploading
  const hasMessages = messages.length > 0
  const latestAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant")
  const latestAssistantSourceCount = latestAssistantMessage
    ? (citationsMap.get(latestAssistantMessage.id)?.length ?? 0)
    : 0

  if (!knowledgeBaseId) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f4efe3_0%,#edf4fb_46%,#fbfbf7_100%)] px-6 py-10 dark:bg-[linear-gradient(180deg,#090b0f_0%,#111824_46%,#0d1117_100%)]">
        <div className="home-mesh pointer-events-none absolute inset-0" />
        <div className={cn("relative w-full max-w-xl rounded-[1.25rem] p-8 text-center", chatSurfaceClass)}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06]">
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
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f4efe3_0%,#edf4fb_46%,#fbfbf7_100%)] px-6 py-10 dark:bg-[linear-gradient(180deg,#090b0f_0%,#111824_46%,#0d1117_100%)]">
        <div className="home-mesh pointer-events-none absolute inset-0" />
        <div className={cn("relative flex w-full max-w-sm flex-col items-center rounded-[1.25rem] p-8 text-center", chatSurfaceClass)}>
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06]">
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
      <div className="relative flex h-dvh flex-col overflow-hidden bg-[linear-gradient(180deg,#f4efe3_0%,#edf4fb_46%,#fbfbf7_100%)] p-3 dark:bg-[linear-gradient(180deg,#090b0f_0%,#111824_46%,#0d1117_100%)]">
        <div className="home-mesh pointer-events-none absolute inset-0" />
        <div className="home-orb-float pointer-events-none absolute -left-20 top-10 h-56 w-56 rounded-full bg-[#e4d0a9]/50 blur-3xl dark:bg-[#654a14]/20" />
        <div className="home-orb-float pointer-events-none absolute right-[-3rem] top-32 h-72 w-72 rounded-full bg-[#c4d9f7]/45 blur-3xl dark:bg-[#19324d]/32 [animation-delay:-5s]" />

        <div className="relative flex min-h-0 flex-1 flex-col gap-3">
          <header className={cn("rounded-[1.25rem] px-4 py-3", chatSurfaceClass)}>
            <div className="flex items-center justify-between gap-3">
              <Link href="/" className="min-w-0">
                <BrandLogo
                  name={knowledgeBase?.name || t.title}
                  className="min-w-0"
                  textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
                />
              </Link>
              <SettingsMenu />
            </div>
          </header>

          <Tabs
            value={mobileTab}
            onValueChange={(value) => setMobileTab(value as "knowledge" | "ask")}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TabsList className={cn("h-auto rounded-[1rem] p-1", chatSurfaceClass)}>
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

            <TabsContent value="ask" className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
              <section className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem]", chatSurfaceClass)}>
                <div className="border-b border-black/8 px-4 py-3 dark:border-white/10">
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-2 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#e0d0aa] bg-[#fbf2d9] text-[#9b6c12] sm:flex dark:border-[#5b4920] dark:bg-[#2b2519] dark:text-[#f5c86b]"
                    >
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t.conversationLabel}</p>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">{knowledgeBase?.name || t.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {knowledgeBase?.description || t.chatInputHint}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  ref={scrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]"
                >
                  {hasMessages ? (
                    <div className="px-4 py-5">
                      <ChatMessages messages={messages} isLoading={isLoading} isStreaming={isStreaming} citationsMap={citationsMap} />
                    </div>
                  ) : (
                    <EmptyState
                      hasKnowledge={hasKnowledge}
                      isPreparingKnowledge={isParsingOrUploading}
                      onSuggestionClick={handleSuggestionClick}
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
                  sourceCount={latestAssistantSourceCount}
                />
              </section>
            </TabsContent>

            <TabsContent value="knowledge" className="mt-3 flex min-h-0 flex-1 overflow-hidden">
              <KnowledgePanel
                files={files}
                onUpload={handleUpload}
                onParse={handleParse}
                onDelete={handleDelete}
                parsingIds={parsingIds}
                deletingIds={deletingIds}
                uploading={uploading}
                collapsed={false}
                initialLoading={isInitialLoading}
                onToggle={() => undefined}
                fullWidth={true}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[linear-gradient(180deg,#f4efe3_0%,#edf4fb_46%,#fbfbf7_100%)] p-3 dark:bg-[linear-gradient(180deg,#090b0f_0%,#111824_46%,#0d1117_100%)] sm:p-4">
      <div className="home-mesh pointer-events-none absolute inset-0" />
      <div className="home-orb-float pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-[#e4d0a9]/50 blur-3xl dark:bg-[#654a14]/20" />
      <div className="home-orb-float pointer-events-none absolute right-[-4rem] top-24 h-96 w-96 rounded-full bg-[#c4d9f7]/50 blur-3xl dark:bg-[#19324d]/34 [animation-delay:-6s]" />
      <div className="home-orb-float pointer-events-none absolute bottom-[-7rem] left-1/3 h-80 w-80 rounded-full bg-[#efcbc2]/40 blur-3xl dark:bg-[#4a2320]/24 [animation-delay:-9s]" />

      <div className="relative mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 lg:gap-4">
        <header className={cn("rounded-[1.25rem] px-4 py-3 sm:px-5", chatSurfaceClass)}>
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="min-w-0">
              <BrandLogo
                name={knowledgeBase?.name || t.title}
                className="min-w-0"
                textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
              />
            </Link>
            <SettingsMenu />
          </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 gap-4 lg:gap-5">
          <KnowledgePanel
            files={files}
            onUpload={handleUpload}
            onParse={handleParse}
            onDelete={handleDelete}
            parsingIds={parsingIds}
            deletingIds={deletingIds}
            uploading={uploading}
            collapsed={panelCollapsed}
            initialLoading={isInitialLoading}
            onToggle={() => setPanelCollapsed((prev) => !prev)}
          />

          <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.25rem]", chatSurfaceClass)}>
            <div className="min-h-0 flex-1">
              {hasMessages ? (
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overscroll-contain px-5 py-6 [-webkit-overflow-scrolling:touch] sm:px-6"
                >
                  <div className="mx-auto max-w-5xl">
                    <ChatMessages messages={messages} isLoading={isLoading} isStreaming={isStreaming} citationsMap={citationsMap} />
                  </div>
                </div>
              ) : (
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto overscroll-contain px-1 [-webkit-overflow-scrolling:touch] sm:px-2"
                >
                  <EmptyState
                    hasKnowledge={hasKnowledge}
                    onSuggestionClick={handleSuggestionClick}
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
              sourceCount={latestAssistantSourceCount}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
