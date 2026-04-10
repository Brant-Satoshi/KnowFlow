"use client"

import { useCallback, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  FileCode,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { FileListItem } from "@/lib/types"
import { cn } from "@/lib/utils"

interface KnowledgePanelProps {
  files: FileListItem[]
  onUpload: (file: File) => void
  onParse: (id: string) => void
  onDelete: (id: string) => Promise<boolean>
  parsingIds: Set<string>
  deletingIds: Set<string>
  uploading: boolean
  collapsed: boolean
  initialLoading?: boolean
  onToggle: () => void
  fullWidth?: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const statusColors: Record<string, string> = {
  uploading: "border-[#c9d6f8] bg-[#eef3ff] text-[#32548d] dark:border-[#2b436d] dark:bg-[#152238] dark:text-[#b8d2ff]",
  uploaded: "border-[#b8d0f0] bg-[#e9f1fc] text-[#27517d] dark:border-[#29527c] dark:bg-[#14314f] dark:text-[#a6d0f6]",
  parsing: "border-[#e9d398] bg-[#fbf2d8] text-[#946815] dark:border-[#5f4c1f] dark:bg-[#302814] dark:text-[#f0c669]",
  deleting: "border-[#dfd0aa] bg-[#faf3df] text-[#8e6a16] dark:border-[#5f4b1c] dark:bg-[#2f2613] dark:text-[#efcf7a]",
  indexed: "border-[#b6d7c7] bg-[#e9f6ef] text-[#1f6b48] dark:border-[#25533f] dark:bg-[#13271e] dark:text-[#97ddb7]",
  failed: "border-[#e3b6b6] bg-[#fae7e7] text-[#9a3d3d] dark:border-[#663737] dark:bg-[#301919] dark:text-[#f3b1b1]",
}

const panelSurfaceClass =
  "border border-white/60 bg-white/76 shadow-[0_30px_80px_-48px_rgba(19,31,56,0.34)] backdrop-blur-xl dark:border-white/10 dark:bg-[#10161d]/84 dark:shadow-[0_30px_80px_-48px_rgba(0,0,0,0.9)]"

export function KnowledgePanel({
  files,
  onUpload,
  onParse,
  onDelete,
  parsingIds,
  deletingIds,
  uploading,
  collapsed,
  initialLoading = false,
  onToggle,
  fullWidth = false,
}: KnowledgePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)
  const [deleteFileName, setDeleteFileName] = useState("")
  const { t } = useLanguage()

  const widthClass = fullWidth ? "w-full" : collapsed ? "w-[80px]" : "w-[19.5rem] xl:w-[21rem]"

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        onUpload(file)
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [onUpload]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setIsDragOver(false)

      const file = event.dataTransfer.files[0]
      if (file) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const handleDeleteClick = useCallback((id: string, name: string) => {
    setDeleteFileId(id)
    setDeleteFileName(name)
  }, [])

  const isDeleting = deleteFileId ? deletingIds.has(deleteFileId) : false

  const handleCloseDeleteDialog = useCallback(() => {
    if (isDeleting) return
    setDeleteFileId(null)
    setDeleteFileName("")
  }, [isDeleting])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteFileId || isDeleting) return

    const deleted = await onDelete(deleteFileId)
    if (deleted) {
      setDeleteFileId(null)
      setDeleteFileName("")
    }
  }, [deleteFileId, isDeleting, onDelete])

  const getStatusText = (status: string) => {
    return t.status[status as keyof typeof t.status] || status
  }

  return (
    <>
      <div
        className={cn(
          "flex min-h-0 shrink-0 flex-col overflow-hidden rounded-[1.25rem] transition-[width] duration-300 ease-in-out",
          panelSurfaceClass,
          "h-full",
          widthClass
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.pdf,.doc,.docx"
          onChange={handleFileSelect}
          disabled={uploading}
          className="hidden"
          id="panel-file-upload"
        />

        {collapsed && !fullWidth ? (
          <div className="flex flex-1 flex-col items-center justify-between px-2 py-4">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#101828] text-white shadow-[0_16px_40px_-20px_rgba(15,23,42,0.85)] dark:bg-white dark:text-zinc-950">
                <FileText className="h-5 w-5" />
              </div>

              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-black/8 bg-black/[0.03] text-foreground transition-colors hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                aria-label={t.uploadFile}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
              onClick={onToggle}
              aria-label={t.togglePanel}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="border-b border-black/8 px-3 py-3 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t.panelEyebrow}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#101828] text-white shadow-[0_16px_40px_-20px_rgba(15,23,42,0.85)] dark:bg-white dark:text-zinc-950">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t.knowledgePanel}</p>
                    </div>
                  </div>
                </div>

                {!fullWidth && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                    onClick={onToggle}
                    aria-label={t.togglePanel}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
              {initialLoading ? (
                <div className="flex flex-1 flex-col">
                  <Skeleton className="h-24 w-full rounded-[0.95rem]" />
                  <div className="mt-3 space-y-2.5">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="rounded-[0.95rem] border border-black/8 p-3 dark:border-white/10">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="mt-3 h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <label
                    htmlFor="panel-file-upload"
                    className={cn(
                      "block cursor-pointer rounded-[0.95rem] border border-dashed px-4 py-4 text-left transition-colors",
                      isDragOver
                        ? "border-primary bg-primary/5"
                        : "border-black/12 bg-black/[0.025] hover:border-primary/40 hover:bg-black/[0.04] dark:border-white/12 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]",
                      uploading && "pointer-events-none cursor-not-allowed opacity-60"
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 text-foreground shadow-sm dark:bg-white/[0.07]">
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {uploading ? t.uploading : t.panelDropTitle}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t.panelDropHint}</p>
                      </div>
                    </div>
                  </label>

                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{t.panelDocumentsLabel}</p>
                  </div>

                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [-webkit-overflow-scrolling:touch]">
                    {files.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center rounded-[0.95rem] border border-black/8 bg-black/[0.02] px-4 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/[0.05] dark:bg-white/[0.08]">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="mt-3 text-sm font-medium text-foreground">{t.panelEmptyTitle}</p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.panelEmptyDesc}</p>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5">
                        {files.map((file) => {
                          const isParsing = parsingIds.has(file.id)
                          const isClientUploading = file.clientStatus === "uploading"
                          const isDeletingFile = deletingIds.has(file.id)
                          const isLoadingFile = isClientUploading || isParsing || file.status === "parsing"
                          const displayStatus = isDeletingFile
                            ? "deleting"
                            : isClientUploading
                              ? "uploading"
                              : file.status
                          const canRetryParse = !isClientUploading && file.status === "failed"

                          return (
                            <div
                              key={file.id}
                              className={cn(
                                "group relative overflow-hidden rounded-[0.85rem] border border-black/8 bg-black/[0.02] p-2 transition-all hover:-translate-y-0.5 hover:bg-black/[0.035] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]",
                                isLoadingFile &&
                                  "border-[#cfdbf8] bg-[#f4f7ff] dark:border-[#2b436d] dark:bg-[#121c2d]"
                              )}
                            >
                              {isLoadingFile && (
                                <>
                                  <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(90deg,rgba(214,226,255,0.28),rgba(255,255,255,0.03),rgba(214,226,255,0.28))] dark:bg-[linear-gradient(90deg,rgba(35,55,87,0.28),rgba(11,18,29,0.03),rgba(35,55,87,0.28))]" />
                                  <span className="file-card-loading-sweep pointer-events-none absolute inset-y-[-18%] left-[-52%] z-[1] w-[52%] rounded-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),rgba(255,255,255,0.95),rgba(255,255,255,0.18),transparent)] opacity-100 dark:bg-[linear-gradient(90deg,transparent,rgba(120,170,255,0.14),rgba(171,206,255,0.58),rgba(120,170,255,0.14),transparent)]" />
                                </>
                              )}

                              <div className="flex items-center gap-2.5">
                                <div
                                  className={cn(
                                    "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] bg-white/80 text-foreground shadow-sm dark:bg-white/[0.07]",
                                    isLoadingFile && "bg-white/90 dark:bg-white/[0.08]"
                                  )}
                                >
                                  {isLoadingFile ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5" />
                                  )}
                                </div>

                                <div className="relative z-10 min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                                    {file.name}
                                  </p>
                                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="shrink-0">{formatSize(file.size)}</span>
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-lg border px-2 py-1 font-medium",
                                        statusColors[displayStatus]
                                      )}
                                    >
                                      {getStatusText(displayStatus)}
                                    </span>

                                    <div className="ml-auto flex items-center gap-1.5">
                                      {canRetryParse && (
                                        <button
                                          onClick={() => onParse(file.id)}
                                          disabled={isParsing || isDeletingFile}
                                          className="inline-flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-black/8 bg-white/70 px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                                          title={t.retryParse}
                                        >
                                          {isParsing ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <FileCode className="h-3 w-3" />
                                          )}
                                          {isParsing ? t.retryingParse : t.retryParse}
                                        </button>
                                      )}

                                      <button
                                        onClick={() => handleDeleteClick(file.id, file.name)}
                                        disabled={isDeletingFile || isClientUploading}
                                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-black/8 bg-white/70 text-foreground transition-colors hover:border-destructive/30 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.06]"
                                        title={isDeletingFile ? t.deleteLoadingAction : t.deleteFile}
                                        aria-label={isDeletingFile ? t.deleteLoadingAction : t.deleteFile}
                                      >
                                        {isDeletingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={deleteFileId !== null} onOpenChange={(open) => !open && handleCloseDeleteDialog()}>
        <DialogContent disableAnimation className="rounded-[1.1rem] border-white/50 bg-[#fcfbf7] dark:border-white/10 dark:bg-[#10151d]">
          <DialogHeader>
            <DialogTitle>{t.confirmDeleteTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
              {t.confirmDeleteDesc.replace("{fileName}", deleteFileName)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseDeleteDialog}
              disabled={isDeleting}
              className="rounded-lg"
            >
              {t.confirmDeleteCancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="rounded-lg"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isDeleting ? t.deleteLoadingAction : t.confirmDeleteAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
