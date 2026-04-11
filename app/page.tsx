"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Edit3, FileText, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { SettingsMenu } from "@/components/settings-menu"
import { toast } from "@/components/ui/use-toast"
import { useErrorToast } from "@/lib/hooks/use-error-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { KnowledgeBase } from "@/lib/types"
import { cn } from "@/lib/utils"

const SURFACE_PANEL_CLASS =
  "border-white/60 bg-white/75 shadow-[0_30px_80px_-45px_rgba(19,31,56,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-[#11161d]/78 dark:shadow-[0_30px_80px_-45px_rgba(0,0,0,0.85)]"
const HOME_CARD_BASE_CLASS = "border shadow-none backdrop-blur-xl"
const CARD_SURFACES = [
  "border-[#ddd8c3] bg-[#f2f2e8] dark:border-[#4a4a3c] dark:bg-[#3a3a2f]",
  "border-[#e4d3cf] bg-[#f7edeb] dark:border-[#4a403d] dark:bg-[#3a3230]",
  "border-[#d8dcec] bg-[#edeffa] dark:border-[#41424b] dark:bg-[#32343e]",
] as const

type KnowledgeBaseErrorData = {
  code?: string
  failedKeys?: string[]
}

type KnowledgeBaseApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}

function sortKnowledgeBases(items: KnowledgeBase[]) {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export default function HomePage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [newKbName, setNewKbName] = useState("")
  const [newKbDesc, setNewKbDesc] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingKnowledgeBase, setEditingKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [isUpdating, setIsUpdating] = useState(false)
  const [deletingKnowledgeBase, setDeletingKnowledgeBase] = useState<KnowledgeBase | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const { home: t } = useLanguage()
  const showErrorToast = useErrorToast()

  const fetchKnowledgeBases = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge-bases")
      const json: KnowledgeBaseApiResponse<{ knowledgeBases: KnowledgeBase[] }> = await res.json()
      if (json.ok && json.data) {
        setKnowledgeBases(sortKnowledgeBases(json.data.knowledgeBases))
      }
    } catch (error) {
      console.error("Failed to fetch knowledge bases:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  const resetCreateState = () => {
    setNewKbName("")
    setNewKbDesc("")
    setIsCreating(false)
  }

  const resetEditState = () => {
    setEditingKnowledgeBase(null)
    setEditName("")
    setEditDescription("")
  }

  const resetDeleteState = () => {
    setDeletingKnowledgeBase(null)
  }

  const handleCreateKnowledgeBase = async () => {
    if (!newKbName.trim()) {
      showErrorToast(t.nameRequired)
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKbName.trim(), description: newKbDesc.trim() }),
      })
      const json: KnowledgeBaseApiResponse<{ knowledgeBase: KnowledgeBase }> = await res.json()
      if (json.ok && json.data) {
        const knowledgeBase = json.data.knowledgeBase
        setKnowledgeBases((prev) => sortKnowledgeBases([knowledgeBase, ...prev]))
        resetCreateState()
        router.push(`/knowledge-bases/${knowledgeBase.id}/chat`)
      } else {
        showErrorToast(json.error || t.createFailed)
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.createFailed)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenEditDialog = (kb: KnowledgeBase) => {
    setEditingKnowledgeBase(kb)
    setEditName(kb.name)
    setEditDescription(kb.description || "")
  }

  const handleOpenDeleteDialog = (kb: KnowledgeBase) => {
    setDeletingKnowledgeBase(kb)
  }

  const handleUpdateKnowledgeBase = async () => {
    if (!editingKnowledgeBase) return

    if (!editName.trim()) {
      showErrorToast(t.nameRequired)
      return
    }

    setIsUpdating(true)
    try {
      const res = await fetch(`/api/knowledge-bases/${editingKnowledgeBase.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      })
      const json: KnowledgeBaseApiResponse<{ knowledgeBase: KnowledgeBase } & KnowledgeBaseErrorData> = await res.json()

      if (res.status === 404) {
        showErrorToast(json.error || t.updateFailed)
        await fetchKnowledgeBases()
        return
      }

      if (json.ok && json.data?.knowledgeBase) {
        const knowledgeBase = json.data.knowledgeBase
        setKnowledgeBases((prev) =>
          sortKnowledgeBases(
            prev.map((kb) => (kb.id === knowledgeBase.id ? knowledgeBase : kb))
          )
        )
        resetEditState()
        toast({
          title: t.updateSuccessTitle,
          description: t.updateSuccessDesc,
        })
      } else {
        showErrorToast(json.error || t.updateFailed)
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.updateFailed)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDeleteKnowledgeBase = async () => {
    if (!deletingKnowledgeBase) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/knowledge-bases/${deletingKnowledgeBase.id}`, {
        method: "DELETE",
      })
      const json: KnowledgeBaseApiResponse<KnowledgeBaseErrorData> = await res.json()

      if (res.status === 404) {
        showErrorToast(json.error || t.deleteFailed)
        await fetchKnowledgeBases()
        return
      }

      if (json.ok) {
        setKnowledgeBases((prev) => prev.filter((kb) => kb.id !== deletingKnowledgeBase.id))
        resetDeleteState()
        toast({
          title: t.deleteSuccessTitle,
          description: t.deleteSuccessDesc,
        })
      } else {
        const message = json.data?.code === "KB_DELETE_FORBIDDEN"
          ? t.defaultKnowledgeBaseDeleteForbidden
          : json.error || t.deleteFailed
        showErrorToast(message)
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t.deleteFailed)
    } finally {
      setIsDeleting(false)
    }
  }

  const formatDate = (
    dateStr: string,
    options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
    }
  ) => {
    return new Date(dateStr).toLocaleDateString(undefined, options)
  }

  const sortedKnowledgeBases = useMemo(() => sortKnowledgeBases(knowledgeBases), [knowledgeBases])

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f5f0e5_0%,#eef4fb_44%,#fdfdf9_100%)] [font-family:var(--font-home-sans)] dark:bg-[linear-gradient(180deg,#090b0f_0%,#121924_45%,#0e1117_100%)]">
      <div className="home-mesh pointer-events-none absolute inset-0" />
      <div className="home-orb-float pointer-events-none absolute right-[-4rem] top-20 h-80 w-80 rounded-full bg-[#c4d9f7]/45 blur-3xl dark:bg-[#19324d]/28 [animation-delay:-6s]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className={cn("flex items-center gap-3 rounded-3xl border px-4 py-3", SURFACE_PANEL_CLASS)}>
            <BrandLogo name={t.title} />
          </div>
          <SettingsMenu />
        </header>

        <main className="flex-1 pt-10 lg:pt-12">
          <section className="mt-12">
            <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                  {t.knowledgeBases}
                </h3>
              </div>
              {sortedKnowledgeBases.length > 0 && (
                <Button
                  onClick={() => setIsCreating(true)}
                  variant="outline"
                  className="rounded-full border-black/10 bg-white/65 px-5 dark:border-white/10 dark:bg-white/6"
                >
                  <Plus className="h-4 w-4" />
                  {t.createKnowledgeBase}
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="mt-6 grid gap-2.5 md:grid-cols-2 md:gap-3 lg:grid-cols-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Card
                    key={index}
                    className={cn(
                      "overflow-hidden rounded-[1.25rem] p-0",
                      HOME_CARD_BASE_CLASS,
                      CARD_SURFACES[index % CARD_SURFACES.length]
                    )}
                  >
                    <CardHeader className="space-y-2 p-4 sm:space-y-3 sm:p-5">
                      <Skeleton className="h-5 w-1/2 sm:h-6" />
                      <Skeleton className="h-3.5 w-full sm:h-4" />
                      <Skeleton className="h-3.5 w-3/4 sm:h-4" />
                    </CardHeader>
                    <CardContent className="space-y-2 pb-4 sm:pb-5">
                      <Skeleton className="h-3.5 w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : sortedKnowledgeBases.length === 0 ? (
              <div className={cn("mt-6 rounded-[1.5rem] border px-6 py-14 text-center", SURFACE_PANEL_CLASS)}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/5 dark:bg-white/8">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <h4 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-foreground">
                  {t.noKnowledgeBases}
                </h4>
                <p className="mx-auto mt-3 max-w-[36ch] text-sm leading-6 text-muted-foreground">
                  {t.noKnowledgeBasesHint}
                </p>
                <Button onClick={() => setIsCreating(true)} className="mt-6 rounded-full px-5">
                  <Plus className="h-4 w-4" />
                  {t.createKnowledgeBase}
                </Button>
              </div>
            ) : (
              <div className="mt-6 grid gap-2.5 md:grid-cols-2 md:gap-3 lg:grid-cols-4">
                {sortedKnowledgeBases.map((kb, index) => {
                  return (
                    <div key={kb.id} className="group relative block focus-within:outline-none">
                      <div className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-full border-black/10 bg-white/85 dark:border-white/10 dark:bg-black/20"
                              aria-label={t.actions}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
                            <DropdownMenuItem onSelect={() => handleOpenEditDialog(kb)}>
                              <Edit3 className="h-4 w-4" />
                              {t.edit}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleOpenDeleteDialog(kb)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <Link href={`/knowledge-bases/${kb.id}/chat`} className="block focus:outline-none">
                        <Card
                          className={cn(
                            "relative rounded-[1.25rem] p-0 transition-transform duration-200 hover:-translate-y-0.5 focus-within:-translate-y-0.5",
                            HOME_CARD_BASE_CLASS,
                            CARD_SURFACES[index % CARD_SURFACES.length]
                          )}
                        >
                          <CardHeader className="gap-2 p-4 sm:gap-3 sm:p-5">
                            <CardTitle className="line-clamp-1 pr-8 text-base font-semibold tracking-[-0.03em] text-zinc-950 sm:text-lg dark:text-zinc-50">
                              {kb.name}
                            </CardTitle>
                            <p className="line-clamp-1 text-sm leading-5 text-zinc-700 sm:line-clamp-2 sm:leading-6 dark:text-zinc-300">
                              {kb.description || t.noDescription}
                            </p>
                            <div className="hidden flex-wrap items-center gap-3 text-xs text-zinc-600 sm:flex dark:text-zinc-400">
                              <span>
                                {t.created} {formatDate(kb.createdAt)}
                              </span>
                              <span className="h-1 w-1 rounded-full bg-current/45" />
                              <span>
                                {t.updatedLabel} {formatDate(kb.updatedAt)}
                              </span>
                            </div>
                          </CardHeader>
                        </Card>
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </main>
      </div>

      <Dialog open={isCreating} onOpenChange={(open) => !isSubmitting && (open ? setIsCreating(true) : resetCreateState())}>
        <DialogContent className="rounded-[1.8rem] border-white/50 bg-[#fcfbf7] p-0 sm:max-w-xl dark:border-white/10 dark:bg-[#10151d]">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="[font-family:var(--font-home-display)] text-3xl font-semibold tracking-[-0.04em]">
                {t.createKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-lg text-sm leading-6">
                {t.dialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={newKbName}
                  onChange={(event) => setNewKbName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleCreateKnowledgeBase()
                    }
                  }}
                  className="h-12 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.description}</label>
                <Textarea
                  placeholder={t.descriptionPlaceholder}
                  value={newKbDesc}
                  onChange={(event) => setNewKbDesc(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      handleCreateKnowledgeBase()
                    }
                  }}
                  className="min-h-[120px] rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 gap-3 sm:justify-end">
              <Button
                variant="outline"
                onClick={resetCreateState}
                className="rounded-full border-black/10 bg-white/70 px-5 dark:border-white/10 dark:bg-white/6"
                disabled={isSubmitting}
              >
                {t.cancel}
              </Button>
              <Button
                onClick={handleCreateKnowledgeBase}
                disabled={!newKbName.trim() || isSubmitting}
                className="rounded-full px-5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.creating}
                  </>
                ) : (
                  t.create
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingKnowledgeBase !== null} onOpenChange={(open) => !isUpdating && !open && resetEditState()}>
        <DialogContent className="rounded-[1.8rem] border-white/50 bg-[#fcfbf7] p-0 sm:max-w-xl dark:border-white/10 dark:bg-[#10151d]">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="[font-family:var(--font-home-display)] text-3xl font-semibold tracking-[-0.04em]">
                {t.editKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-lg text-sm leading-6">
                {t.editDialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleUpdateKnowledgeBase()
                    }
                  }}
                  className="h-12 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.description}</label>
                <Textarea
                  placeholder={t.descriptionPlaceholder}
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      handleUpdateKnowledgeBase()
                    }
                  }}
                  className="min-h-[120px] rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 gap-3 sm:justify-end">
              <Button
                variant="outline"
                onClick={resetEditState}
                className="rounded-full border-black/10 bg-white/70 px-5 dark:border-white/10 dark:bg-white/6"
                disabled={isUpdating}
              >
                {t.cancel}
              </Button>
              <Button
                onClick={handleUpdateKnowledgeBase}
                disabled={!editName.trim() || isUpdating}
                className="rounded-full px-5"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.saving}
                  </>
                ) : (
                  t.save
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingKnowledgeBase !== null} onOpenChange={(open) => !isDeleting && !open && resetDeleteState()}>
        <DialogContent disableAnimation className="rounded-[1.1rem] border-white/50 bg-[#fcfbf7] dark:border-white/10 dark:bg-[#10151d]">
          <DialogHeader>
            <DialogTitle>{t.confirmDeleteTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
              {t.confirmDeleteDesc.replace("{knowledgeBaseName}", deletingKnowledgeBase?.name || "")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={resetDeleteState}
              disabled={isDeleting}
              className="rounded-lg"
            >
              {t.confirmDeleteCancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteKnowledgeBase}
              disabled={isDeleting}
              className="rounded-lg"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isDeleting ? t.deleting : t.confirmDeleteAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
