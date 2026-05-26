"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
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
import { useLanguage } from "@/lib/i18n/LanguageContext"
import type { ConversationSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

interface ConversationSidebarProps {
  conversations: ConversationSummary[]
  currentId: string | null
  isLoading: boolean
  isCreating: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
  fullWidth?: boolean
  className?: string
}

export function ConversationSidebar({
  conversations,
  currentId,
  isLoading,
  isCreating,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  fullWidth = false,
  className,
}: ConversationSidebarProps) {
  const { t } = useLanguage()

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteTitle, setDeleteTitle] = useState("")
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const startRename = useCallback((conv: ConversationSummary) => {
    setRenamingId(conv.id)
    setRenameValue(conv.title)
  }, [])

  const cancelRename = useCallback(() => {
    if (renameSaving) return
    setRenamingId(null)
    setRenameValue("")
  }, [renameSaving])

  const submitRename = useCallback(async () => {
    if (!renamingId || renameSaving) return
    const trimmed = renameValue.trim()
    if (!trimmed) {
      cancelRename()
      return
    }
    setRenameSaving(true)
    const ok = await onRename(renamingId, trimmed)
    setRenameSaving(false)
    if (ok) {
      setRenamingId(null)
      setRenameValue("")
    }
  }, [cancelRename, onRename, renameSaving, renameValue, renamingId])

  const requestDelete = useCallback((conv: ConversationSummary) => {
    setDeleteId(conv.id)
    setDeleteTitle(conv.title || t.untitledConversation)
  }, [t.untitledConversation])

  const closeDelete = useCallback(() => {
    if (deleting) return
    setDeleteId(null)
    setDeleteTitle("")
  }, [deleting])

  const confirmDelete = useCallback(async () => {
    if (!deleteId || deleting) return
    setDeleting(true)
    const ok = await onDelete(deleteId)
    setDeleting(false)
    if (ok) {
      setDeleteId(null)
      setDeleteTitle("")
    }
  }, [deleteId, deleting, onDelete])

  const widthClass = fullWidth ? "w-full" : "w-[15rem] xl:w-[16rem]"

  return (
    <>
      <div
        className={cn(
          "relative z-10 flex h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card",
          widthClass,
          className
        )}
      >
        <div className="border-b border-border px-4 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t.conversationsEyebrow}
            </p>
          </div>
          <Button
            onClick={onCreate}
            disabled={isCreating}
            variant="outline"
            className="mt-2.5 h-9 w-full justify-start rounded-[9px] text-[12.5px] font-medium"
          >
            {isCreating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t.newChat}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
          {isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded-[9px]" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-3 py-8 text-center">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[12.5px] font-medium text-foreground">{t.noConversations}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {t.noConversationsHint}
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conv) => {
                const isActive = conv.id === currentId
                const isRenaming = conv.id === renamingId
                const displayTitle = conv.title || t.untitledConversation

                return (
                  <li key={conv.id}>
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5 rounded-[9px] border border-primary/30 bg-primary/5 px-2 py-1.5">
                        <Input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          placeholder={t.renameConversationPlaceholder}
                          disabled={renameSaving}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              void submitRename()
                            } else if (e.key === "Escape") {
                              e.preventDefault()
                              cancelRename()
                            }
                          }}
                          className="h-7 border-0 bg-transparent px-1 text-[12.5px] focus-visible:ring-0"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] cursor-pointer"
                          disabled={renameSaving}
                          onClick={() => void submitRename()}
                        >
                          {renameSaving ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            t.saveTitle
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] text-muted-foreground cursor-pointer"
                          disabled={renameSaving}
                          onClick={cancelRename}
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "group flex items-center gap-1 rounded-[9px] border px-2 py-1.5 transition-colors",
                          isActive
                            ? "border-primary/30 bg-primary/8"
                            : "border-transparent hover:border-border hover:bg-secondary"
                        )}
                      >
                        <button
                          onClick={() => onSelect(conv.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <MessageSquare
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              isActive ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span
                            className={cn(
                              "truncate text-[12.5px] font-medium",
                              isActive ? "text-foreground" : "text-foreground/85"
                            )}
                            title={displayTitle}
                          >
                            {displayTitle}
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className={cn(
                                "inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground",
                                "opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100",
                                isActive && "opacity-100"
                              )}
                              aria-label={t.conversationActions}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onSelect={() => startRename(conv)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              {t.renameConversation}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => requestDelete(conv)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              {t.deleteConversation}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent disableAnimation className="rounded-[1.1rem]">
          <DialogHeader>
            <DialogTitle>{t.confirmDeleteConversationTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
              {t.confirmDeleteConversationDesc.replace("{conversationTitle}", deleteTitle)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDelete}
              disabled={deleting}
              className="rounded-lg"
            >
              {t.confirmDeleteConversationCancel}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-lg"
            >
              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t.confirmDeleteConversationAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
