"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, BookmarkPlus, Edit3, Loader2, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react"
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

// ── Constants ──────────────────────────────────────────────────────────────────
const RECENTS_KEY = "rag-studio-recent-kbs"
const MAX_RECENTS = 4

// ── Types ──────────────────────────────────────────────────────────────────────
type KnowledgeBaseErrorData = {
  code?: string
  failedKeys?: string[]
}

type KnowledgeBaseApiResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function sortKnowledgeBases(items: KnowledgeBase[]) {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

function getRecentIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]")
  } catch {
    return []
  }
}

function pushRecentId(id: string) {
  const ids = getRecentIds().filter((r) => r !== id)
  localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...ids].slice(0, MAX_RECENTS)))
}

function removeRecentId(id: string) {
  const ids = getRecentIds().filter((r) => r !== id)
  localStorage.setItem(RECENTS_KEY, JSON.stringify(ids))
}

// ── Recents Strip ──────────────────────────────────────────────────────────────
function RecentsStrip({
  kbs,
  recentIds,
  onRemove,
  t,
}: {
  kbs: KnowledgeBase[]
  recentIds: string[]
  onRemove: (id: string) => void
  t: ReturnType<typeof useLanguage>["home"]
}) {
  const recents = recentIds
    .map((id) => kbs.find((k) => k.id === id))
    .filter((k): k is KnowledgeBase => Boolean(k))

  if (!recents.length) return null

  return (
    <div className="mb-8">
      <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {t.recentlyOpened}
      </p>
      <div className="flex flex-wrap gap-2">
        {recents.map((kb) => (
          <div key={kb.id} className="group/chip flex items-center rounded-lg border border-border bg-card transition-colors hover:bg-secondary">
            <Link
              href={`/knowledge-bases/${kb.id}/chat`}
              onClick={() => pushRecentId(kb.id)}
              className="flex cursor-pointer items-center gap-2 px-3.5 py-2"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--card-accent-0)]" />
              <span className="max-w-[160px] truncate font-mono text-xs font-medium text-foreground">{kb.name}</span>
            </Link>
            <button
              onClick={() => onRemove(kb.id)}
              className="mr-1.5 cursor-pointer rounded-full p-0.5 text-muted-foreground transition-opacity hover:text-foreground md:opacity-0 md:group-hover/chip:opacity-100"
              aria-label={t.removeFromRecents}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── KB Card ────────────────────────────────────────────────────────────────────
function KBCard({
  kb,
  index,
  onEdit,
  onDelete,
  onAddToRecent,
  isRecent,
  t,
}: {
  kb: KnowledgeBase
  index: number
  onEdit: (kb: KnowledgeBase) => void
  onDelete: (kb: KnowledgeBase) => void
  onAddToRecent: (kb: KnowledgeBase) => void
  isRecent: boolean
  t: ReturnType<typeof useLanguage>["home"]
}) {
  const volNum = String(index + 1).padStart(2, "0")
  const accentVar = `var(--card-accent-${index % 5})`
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  return (
    <div className="group relative">
      {/* Context menu */}
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full transition-opacity hover:bg-black/8 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-white/10"
              aria-label={t.actions}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
            <DropdownMenuItem onSelect={() => onEdit(kb)}>
              <Edit3 className="h-4 w-4" />
              {t.edit}
            </DropdownMenuItem>
            {!isRecent && (
              <DropdownMenuItem onSelect={() => onAddToRecent(kb)}>
                <BookmarkPlus className="h-4 w-4" />
                {t.addToRecent}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => onDelete(kb)}
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
        onClick={() => pushRecentId(kb.id)}
        className={cn(
          "home-card-enter flex h-[160px] cursor-pointer flex-col justify-between rounded-2xl bg-card p-4 sm:h-[220px]",
          "transition-shadow duration-200 hover:shadow-[0_8px_28px_rgba(0,0,0,0.10)] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        )}
        style={{
          borderTop: `3px solid ${accentVar}`,
          animationDelay: `${index * 55}ms`,
        }}
      >
        <span className="font-mono text-[11px] font-medium text-muted-foreground">{volNum}</span>
        <div>
          <p className="font-sans line-clamp-2 text-[18px] font-semibold leading-snug tracking-[-0.015em] text-foreground">
            {kb.name}
          </p>
          <div className="mt-2.5 flex items-center justify-between">
            <p className="font-mono text-[11px] text-muted-foreground">{fmtDate(kb.updatedAt)}</p>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </Link>
    </div>
  )
}

// ── New KB card ────────────────────────────────────────────────────────────────
function NewKBCard({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex h-[160px] w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-black/15 bg-transparent text-muted-foreground transition-colors hover:border-black/25 hover:bg-card/60 sm:h-[220px] dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-card/60"
    >
      <span className="font-display text-[44px] font-light italic leading-none text-muted-foreground/50">+</span>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.10em] text-muted-foreground/70">
        {label}
      </span>
    </button>
  )
}

// ── Empty State ────────────────────────────────────────────────────────────────
function EmptyState({ onCreate, t }: { onCreate: () => void; t: ReturnType<typeof useLanguage>["home"] }) {
  return (
    <div className="flex flex-col items-center gap-6 py-24 text-center">
      <p className="font-display text-[38px] font-bold italic leading-none tracking-[-0.01em] text-foreground/50 sm:text-[48px]">
        {t.emptyCollectionTitle}
      </p>
      <p className="font-mono text-sm text-muted-foreground">{t.noKnowledgeBasesHint}</p>
      <Button onClick={onCreate} className="mt-1 h-9 rounded-full px-6 font-mono text-xs font-medium tracking-wide">
        <Plus className="h-3.5 w-3.5" />
        {t.createKnowledgeBase}
      </Button>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
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
  const [recentIds, setRecentIds] = useState<string[]>([])
  const router = useRouter()
  const { home: t } = useLanguage()
  const showErrorToast = useErrorToast()

  // Read recents from localStorage on mount
  useEffect(() => {
    setRecentIds(getRecentIds())
  }, [])

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
        pushRecentId(knowledgeBase.id)
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

  const handleUpdateKnowledgeBase = async () => {
    if (!editingKnowledgeBase || !editName.trim()) {
      if (!editName.trim()) showErrorToast(t.nameRequired)
      return
    }
    setIsUpdating(true)
    try {
      const res = await fetch(`/api/knowledge-bases/${editingKnowledgeBase.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDescription.trim() }),
      })
      const json: KnowledgeBaseApiResponse<{ knowledgeBase: KnowledgeBase } & KnowledgeBaseErrorData> = await res.json()
      if (res.status === 404) {
        showErrorToast(json.error || t.updateFailed)
        await fetchKnowledgeBases()
        return
      }
      if (json.ok && json.data?.knowledgeBase) {
        setKnowledgeBases((prev) =>
          sortKnowledgeBases(prev.map((kb) => kb.id === json.data!.knowledgeBase!.id ? json.data!.knowledgeBase! : kb))
        )
        resetEditState()
        toast({ title: t.updateSuccessTitle, description: t.updateSuccessDesc })
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
      const res = await fetch(`/api/knowledge-bases/${deletingKnowledgeBase.id}`, { method: "DELETE" })
      const json: KnowledgeBaseApiResponse<KnowledgeBaseErrorData> = await res.json()
      if (res.status === 404) {
        showErrorToast(json.error || t.deleteFailed)
        await fetchKnowledgeBases()
        return
      }
      if (json.ok) {
        setKnowledgeBases((prev) => prev.filter((kb) => kb.id !== deletingKnowledgeBase.id))
        removeRecentId(deletingKnowledgeBase.id)
        setRecentIds((prev) => prev.filter((id) => id !== deletingKnowledgeBase.id))
        resetDeleteState()
        toast({ title: t.deleteSuccessTitle, description: t.deleteSuccessDesc })
      } else {
        const message =
          json.data?.code === "KB_DELETE_FORBIDDEN"
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

  const filteredKnowledgeBases = useMemo(() => {
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
    <div className="home-grain min-h-screen bg-background">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 flex h-[52px] items-center justify-between border-b border-border bg-background px-5">
        <BrandLogo name={t.title} iconSize={28} />

        <div className="flex items-center gap-1.5">
          <Button
            onClick={() => setIsCreating(true)}
            variant="ghost"
            className="h-8 rounded-full px-3.5 font-mono text-xs font-medium tracking-wide"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.newCollection}</span>
            <span className="sm:hidden">{t.newCollectionShort}</span>
          </Button>
          <SettingsMenu />
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Page heading */}
        <div className="mb-9">
          <div className="flex items-end justify-between">
            <h1 className="font-sans text-[38px] font-semibold leading-none tracking-[-0.025em] text-foreground sm:text-[50px]">
              {t.knowledgeBases}
            </h1>
            {!isLoading && filteredKnowledgeBases.length > 0 && (
              <span className="mb-1.5 shrink-0 whitespace-nowrap pl-3 font-mono text-[11px] text-muted-foreground">
                {filteredKnowledgeBases.length} {filteredKnowledgeBases.length === 1 ? t.volume : t.volumes}
              </span>
            )}
          </div>

          {/* Inline editorial search */}
          <div className="mt-4 flex items-center gap-3 border-b border-border pb-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Recents */}
        {!isLoading && (
          <RecentsStrip
            kbs={knowledgeBases}
            recentIds={recentIds}
            onRemove={(id) => {
              removeRecentId(id)
              setRecentIds((prev) => prev.filter((r) => r !== id))
            }}
            t={t}
          />
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[160px] rounded-2xl sm:h-[220px]" />
            ))}
          </div>
        ) : filteredKnowledgeBases.length === 0 && !searchQuery ? (
          <EmptyState onCreate={() => setIsCreating(true)} t={t} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <NewKBCard onClick={() => setIsCreating(true)} label={t.newCollection} />
            {filteredKnowledgeBases.map((kb, index) => (
              <KBCard
                key={kb.id}
                kb={kb}
                index={index}
                onEdit={(kb) => {
                  setEditingKnowledgeBase(kb)
                  setEditName(kb.name)
                  setEditDescription(kb.description || "")
                }}
                onDelete={setDeletingKnowledgeBase}
                onAddToRecent={(kb) => {
                  pushRecentId(kb.id)
                  setRecentIds(getRecentIds())
                }}
                isRecent={recentIds.includes(kb.id)}
                t={t}
              />
            ))}
          </div>
        )}

        {!isLoading && filteredKnowledgeBases.length === 0 && searchQuery && (
          <p className="mt-12 text-center font-mono text-sm text-muted-foreground">
            {t.noResults.replace("{query}", searchQuery)}
          </p>
        )}
      </main>

      {/* ── Create dialog ───────────────────────────────────────────── */}
      <Dialog
        open={isCreating}
        onOpenChange={(open) => !isSubmitting && (open ? setIsCreating(true) : resetCreateState())}
      >
        <DialogContent className="rounded-[1.8rem] border-black/8 bg-popover p-0 sm:max-w-xl dark:border-white/8 dark:bg-popover">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,248,230,0.6)_0%,rgba(255,248,230,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="text-[22px] font-semibold tracking-tight">
                {t.createKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6">
                {t.dialogDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-7 space-y-5">
              <div className="space-y-2.5">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateKnowledgeBase() }}
                  className="h-11 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2.5">
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
                disabled={isSubmitting}
                className="rounded-full border-black/10 bg-white/70 px-5 dark:border-white/10 dark:bg-white/6"
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

      {/* ── Edit dialog ─────────────────────────────────────────────── */}
      <Dialog
        open={editingKnowledgeBase !== null}
        onOpenChange={(open) => !isUpdating && !open && resetEditState()}
      >
        <DialogContent className="rounded-[1.8rem] border-black/8 bg-popover p-0 sm:max-w-xl dark:border-white/8 dark:bg-popover">
          <div className="rounded-[1.8rem] border border-black/5 bg-[linear-gradient(180deg,rgba(255,248,230,0.6)_0%,rgba(255,248,230,0)_100%)] p-6 dark:border-white/5 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_100%)]">
            <DialogHeader className="text-left">
              <DialogTitle className="text-[22px] font-semibold tracking-tight">
                {t.editKnowledgeBase}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-6">
                {t.editDialogDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-7 space-y-5">
              <div className="space-y-2.5">
                <label className="text-sm font-medium text-foreground">{t.name}</label>
                <Input
                  placeholder={t.namePlaceholder}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleUpdateKnowledgeBase() }}
                  className="h-11 rounded-2xl border-black/10 bg-white/80 dark:border-white/10 dark:bg-white/6"
                />
              </div>
              <div className="space-y-2.5">
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
                disabled={isUpdating}
                className="rounded-full border-black/10 bg-white/70 px-5 dark:border-white/10 dark:bg-white/6"
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

      {/* ── Delete dialog ───────────────────────────────────────────── */}
      <Dialog
        open={deletingKnowledgeBase !== null}
        onOpenChange={(open) => !isDeleting && !open && resetDeleteState()}
      >
        <DialogContent disableAnimation className="rounded-[1.1rem] border-black/8 bg-popover dark:border-white/8 dark:bg-popover">
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
