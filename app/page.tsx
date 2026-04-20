"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Edit3,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
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

const CARD_COLORS = [
  "bg-[#f5f2e8] dark:bg-[#3a3a2f]",
  "bg-[#eceef8] dark:bg-[#32343e]",
  "bg-[#e8f0f8] dark:bg-[#2d3540]",
  "bg-[#eef5ee] dark:bg-[#2d3a2d]",
  "bg-[#f7edeb] dark:bg-[#3a3230]",
] as const

const CARD_EMOJIS = ["📓", "🤖", "🚀", "🎨", "📜", "🔬", "💡", "🌍", "📊", "🔧"]

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
  const [searchQuery, setSearchQuery] = useState("")
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

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  const sortedKnowledgeBases = useMemo(() => {
    const sorted = sortKnowledgeBases(knowledgeBases)
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.toLowerCase()
    return sorted.filter(
      (kb) =>
        kb.name.toLowerCase().includes(q) ||
        (kb.description || "").toLowerCase().includes(q)
    )
  }, [knowledgeBases, searchQuery])

  return (
    <div className="min-h-screen bg-[#f8f7f4] dark:bg-[#0e1117]">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/6 bg-[#f8f7f4]/90 px-6 py-3.5 backdrop-blur-sm dark:border-white/6 dark:bg-[#0e1117]/90">
        <BrandLogo name={t.title} />
        <SettingsMenu />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Toolbar */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-zinc-900 dark:text-zinc-50">
            {t.knowledgeBases}
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="h-9 w-48 rounded-full border-black/10 bg-white/80 pl-9 text-sm dark:border-white/10 dark:bg-white/6"
              />
            </div>
            <Button
              onClick={() => setIsCreating(true)}
              className="h-9 rounded-full px-4 text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              {t.createKnowledgeBase}
            </Button>
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* New KB card */}
            <button
              onClick={() => setIsCreating(true)}
              className="flex h-44 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-black/12 bg-white/50 text-zinc-500 transition-colors hover:border-black/20 hover:bg-white/70 dark:border-white/10 dark:bg-white/3 dark:text-zinc-400 dark:hover:border-white/20"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/6 dark:bg-white/8">
                <Plus className="h-6 w-6" />
              </div>
              <span className="text-sm font-medium">{t.createKnowledgeBase}</span>
            </button>

            {sortedKnowledgeBases.map((kb, index) => {
              const emoji = CARD_EMOJIS[index % CARD_EMOJIS.length]
              const color = CARD_COLORS[index % CARD_COLORS.length]
              return (
                <div key={kb.id} className="group relative">
                  <div className="absolute right-2.5 top-2.5 z-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full opacity-0 transition-opacity hover:bg-black/8 group-hover:opacity-100 dark:hover:bg-white/10"
                          aria-label={t.actions}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 rounded-xl p-1.5">
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

                  <Link
                    href={`/knowledge-bases/${kb.id}/chat`}
                    className={cn(
                      "flex h-44 flex-col justify-between rounded-2xl p-4 transition-transform duration-150 hover:-translate-y-0.5",
                      color
                    )}
                  >
                    <span className="text-3xl leading-none">{emoji}</span>
                    <div>
                      <p className="line-clamp-2 text-sm font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-100">
                        {kb.name}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {formatDate(kb.updatedAt)}
                      </p>
                    </div>
                  </Link>
                </div>
              )
            })}
          </div>
        )}

        {!isLoading && sortedKnowledgeBases.length === 0 && searchQuery && (
          <p className="mt-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No results for &ldquo;{searchQuery}&rdquo;
          </p>
        )}
      </main>

      {/* Create dialog */}
      <Dialog open={isCreating} onOpenChange={(open) => !isSubmitting && (open ? setIsCreating(true) : resetCreateState())}>
        <DialogContent className="rounded-[1.8rem] border-white/50 bg-[#fcfbf7] p-0 sm:max-w-xl dark:border-white/10 dark:bg-[#10151d]">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="text-2xl font-semibold tracking-[-0.03em]">
                {t.createKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6">
                {t.dialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateKnowledgeBase() }}
                  className="h-11 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.description}</label>
                <Textarea
                  placeholder={t.descriptionPlaceholder}
                  value={newKbDesc}
                  onChange={(e) => setNewKbDesc(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreateKnowledgeBase() }}
                  className="min-h-[100px] rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 gap-2 sm:justify-end">
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
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.creating}</>
                ) : t.create}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editingKnowledgeBase !== null} onOpenChange={(open) => !isUpdating && !open && resetEditState()}>
        <DialogContent className="rounded-[1.8rem] border-white/50 bg-[#fcfbf7] p-0 sm:max-w-xl dark:border-white/10 dark:bg-[#10151d]">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.8)_0%,rgba(255,255,255,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="text-2xl font-semibold tracking-[-0.03em]">
                {t.editKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6">
                {t.editDialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleUpdateKnowledgeBase() }}
                  className="h-11 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t.description}</label>
                <Textarea
                  placeholder={t.descriptionPlaceholder}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleUpdateKnowledgeBase() }}
                  className="min-h-[100px] rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 gap-2 sm:justify-end">
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
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t.saving}</>
                ) : t.save}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
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
