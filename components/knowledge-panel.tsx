"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { FileText, ChevronLeft, ChevronRight, Upload, Trash2, FileCode, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { FileDoc } from "@/lib/types"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface KnowledgePanelProps {
  files: FileDoc[]
  onUpload: (file: File) => void
  onParse: (id: string) => void
  onDelete: (id: string) => void
  parsingIds: Set<string>
  deletingIds?: Set<string>
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
  uploaded: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  parsing: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  indexed: "bg-green-500/10 text-green-700 dark:text-green-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
}

const PANEL_WIDTH_TRANSITION_MS = 300

export function KnowledgePanel({
  files,
  onUpload,
  onParse,
  onDelete,
  parsingIds,
  uploading,
  collapsed,
  initialLoading = false,
  onToggle,
  fullWidth = false,
}: KnowledgePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showExpandedContent, setShowExpandedContent] = useState(!collapsed)
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)
  const [deleteFileName, setDeleteFileName] = useState<string>("")
  const { t } = useLanguage()

  useEffect(() => {
    if (collapsed) {
      const hideTimer = window.setTimeout(() => {
        setShowExpandedContent(false)
      }, 0)

      return () => window.clearTimeout(hideTimer)
    }

    const timer = window.setTimeout(() => {
      setShowExpandedContent(true)
    }, PANEL_WIDTH_TRANSITION_MS)

    return () => window.clearTimeout(timer)
  }, [collapsed])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [onUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        onUpload(file)
      }
    },
    [onUpload]
  )

  const getStatusText = (status: string): string => {
    return t.status[status as keyof typeof t.status] || status
  }

  const handleDeleteClick = useCallback((id: string, name: string) => {
    setDeleteFileId(id)
    setDeleteFileName(name)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (deleteFileId) {
      onDelete(deleteFileId)
      setDeleteFileId(null)
    }
  }, [deleteFileId, onDelete])

  const widthClass = fullWidth ? "w-full" : collapsed ? "w-14" : "w-80"

  return (
    <>
      <div
        className={cn(
          "flex flex-col overflow-hidden bg-card transition-[width] duration-300 ease-in-out",
          fullWidth ? "h-full rounded-none border-0" : "my-4 rounded-2xl border-r border-border",
          widthClass
        )}
      >
        <div
          className={cn(
            "flex items-center border-b chat-surface-border",
            collapsed ? "justify-center px-2 py-3" : "justify-between p-3"
          )}
        >
          {!collapsed && showExpandedContent && (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{t.knowledgePanel}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {files.length}
              </span>
            </div>
          )}
          {!fullWidth && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              onClick={onToggle}
              aria-label={collapsed ? "Expand knowledge panel" : "Collapse knowledge panel"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {!collapsed && showExpandedContent ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {initialLoading ? (
              <div className="flex flex-1 flex-col overflow-hidden p-3">
                <Skeleton className="h-14 w-full rounded-md" />
                <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <div key={`panel-skeleton-${idx}`} className="rounded-lg border chat-surface-border p-2">
                      <div className="flex items-start gap-2">
                        <Skeleton className="mt-0.5 h-3.5 w-3.5 rounded-sm" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Skeleton className="h-3 w-4/5" />
                          <Skeleton className="h-2.5 w-2/3" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-border p-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.txt,.pdf,.doc,.docx"
                    onChange={handleFileSelect}
                    disabled={uploading}
                    className="hidden"
                    id="panel-file-upload"
                  />
                  <label
                    htmlFor="panel-file-upload"
                    className={cn(
                      "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed chat-surface-border p-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary",
                      isDragOver && "border-primary bg-primary/5",
                      uploading && "pointer-events-none opacity-50"
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t.uploading}</span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        <span>{t.uploadFile}</span>
                      </>
                    )}
                  </label>
                  <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                    {t.supportedFormats}
                  </p>
                </div>

                {/* File List */}
                <div className="flex-1 overflow-y-auto p-2">
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <FileText className="mb-2 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">{t.noFiles}</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">
                        {t.noFilesHint}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {files.map((file) => {
                        const isParsing = parsingIds.has(file.id)
                        return (
                          <div
                            key={file.id}
                            className="group flex items-start gap-2 rounded-lg border chat-surface-border p-2 transition-colors hover:bg-secondary"
                          >
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground" title={file.name}>
                                {file.name}
                              </p>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{formatSize(file.size)}</span>
                                <span
                                  className={cn("rounded-full px-1.5 py-0.5", statusColors[file.status])}
                                >
                                  {getStatusText(file.status)}
                                </span>
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {file.status === "uploaded" && (
                                <button
                                  onClick={() => onParse(file.id)}
                                  disabled={isParsing}
                                  className="rounded cursor-pointer p-1 text-muted-foreground hover:text-primary disabled:pointer-events-none"
                                  title={t.parseFile}
                                >
                                  {isParsing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <FileCode className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteClick(file.id, file.name)}
                                className="rounded cursor-pointer p-1 text-muted-foreground hover:text-destructive"
                                title={t.deleteFile}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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
        ) : null}
      </div>

      <Dialog open={deleteFileId !== null} onOpenChange={(open) => !open && setDeleteFileId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.confirmDeleteTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.confirmDeleteDesc.replace("{fileName}", deleteFileName)}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFileId(null)}>
              {t.cancel}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t.deleteFile}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
