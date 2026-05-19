"use client"

import { useCallback, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  FileCode,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { FileListItem } from "@/lib/types"
import { cn } from "@/lib/utils"

interface KnowledgePanelProps {
  files: FileListItem[]
  onUpload: (file: File) => void
  onParse: (id: string) => void
  onDelete: (id: string) => void
  parsingIds: Set<string>
  uploading: boolean
  collapsed: boolean
  initialLoading?: boolean
  onToggle: () => void
  fullWidth?: boolean
  side?: "left" | "right"
  className?: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// File extension → accent color
const EXT_COLORS: Record<string, string> = {
  md:   "#7C83F7",
  pdf:  "#F77C7C",
  doc:  "#7CBEF7",
  docx: "#7CBEF7",
  txt:  "#A0A8C0",
  csv:  "#7FE0B0",
}

function FileExtBadge({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const color = EXT_COLORS[ext] ?? "#A0A8C0"
  return (
    <div
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px]"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 16%, transparent)`,
      }}
    >
      <span
        className="font-mono text-[9px] font-semibold tracking-tight"
        style={{ color }}
      >
        {ext.toUpperCase().slice(0, 4) || "—"}
      </span>
    </div>
  )
}

const statusStyles: Record<string, { color: string; bg: string }> = {
  uploading: { color: "hsl(var(--primary))",    bg: "hsl(var(--primary) / 0.12)" },
  uploaded:  { color: "hsl(var(--primary))",    bg: "hsl(var(--primary) / 0.12)" },
  parsing:   { color: "#f59e0b",                bg: "rgba(245,158,11,0.12)" },
  indexed:   { color: "oklch(0.65 0.14 165)",   bg: "oklch(0.65 0.14 165 / 0.13)" },
  deleting:  { color: "oklch(0.65 0.14 165)",   bg: "oklch(0.65 0.14 165 / 0.10)" },
  failed:    { color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.12)" },
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = statusStyles[status] ?? statusStyles.indexed
  const isPulsing = status === "parsing" || status === "uploading"
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-[5px] px-[7px] py-[2px] font-mono text-[10px] font-medium tracking-wider"
      style={{ color: s.color, background: s.bg }}
    >
      {isPulsing && (
        <span
          className="inline-block h-[5px] w-[5px] animate-pulse rounded-full"
          style={{ background: s.color }}
        />
      )}
      {label}
    </span>
  )
}

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
  side = "left",
  className,
}: KnowledgePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)
  const [deleteFileName, setDeleteFileName] = useState("")
  const { t } = useLanguage()

  const widthClass = fullWidth ? "w-full" : collapsed ? "w-[64px]" : "w-[17rem] xl:w-[18.5rem]"
  const CollapseIcon = side === "right" ? ChevronRight : ChevronLeft
  const ExpandIcon = side === "right" ? ChevronLeft : ChevronRight

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) onUpload(file)
      if (fileInputRef.current) fileInputRef.current.value = ""
    },
    [onUpload]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setIsDragOver(false)
      const file = event.dataTransfer.files[0]
      if (file) onUpload(file)
    },
    [onUpload]
  )

  const handleConfirmDelete = useCallback(() => {
    if (!deleteFileId) return
    onDelete(deleteFileId)
    setDeleteFileId(null)
    setDeleteFileName("")
  }, [deleteFileId, onDelete])

  const handleCloseDeleteDialog = useCallback(() => {
    setDeleteFileId(null)
    setDeleteFileName("")
  }, [])

  const indexedCount = files.filter(f => f.status === "indexed").length

  return (
    <>
      <div
        className={cn(
          "relative z-10 flex h-full shrink-0 flex-col overflow-hidden border border-border bg-card",
          widthClass,
          className
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

        {/* —— Collapsed —— */}
        {collapsed && !fullWidth ? (
          <div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-4">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-[9px] border-primary/15 bg-primary/8 text-primary shadow-sm hover:bg-primary/12"
              onClick={onToggle}
              aria-label={t.togglePanel}
              aria-expanded={!collapsed}
            >
              <ExpandIcon className="h-4 w-4" />
            </Button>

            <div className="h-px w-7 bg-border" />

            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-[9px]"
              aria-label={t.uploadFile}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>

            {files.length > 0 && (
              <>
                <div className="h-px w-7 bg-border" />
                <TooltipProvider delayDuration={200}>
                  <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-1">
                    {files.map((file) => (
                      <Tooltip key={file.id}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={onToggle}
                            aria-label={file.name}
                            className="cursor-pointer rounded-[7px] transition-transform hover:scale-[1.06]"
                          >
                            <FileExtBadge name={file.name} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side={side === "right" ? "left" : "right"}
                          className="max-w-[220px] break-words font-mono text-[12px]"
                        >
                          {file.name}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </TooltipProvider>
              </>
            )}
          </div>
        ) : (
          /* —— Expanded —— */
          <>
            {/* Panel header */}
            <div className="border-b border-border px-4 py-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t.panelEyebrow}
                </p>
                {!fullWidth && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-[7px] text-muted-foreground hover:text-foreground"
                    onClick={onToggle}
                    aria-label={t.togglePanel}
                    aria-expanded={!collapsed}
                  >
                    <CollapseIcon className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="mt-2.5 flex items-center gap-2.5 rounded-[9px] bg-secondary px-2.5 py-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
                  <Upload className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold leading-none text-foreground">{t.knowledgePanel}</p>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">{indexedCount} {t.indexedLabel}</p>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-3.5 py-3.5">
              {initialLoading ? (
                <div className="flex flex-1 flex-col gap-2.5">
                  <Skeleton className="h-20 w-full rounded-xl" />
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-border p-3">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="mt-2 h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {/* Upload zone */}
                  <label
                    htmlFor="panel-file-upload"
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                    onDragLeave={e => { e.preventDefault(); setIsDragOver(false) }}
                    onDrop={handleDrop}
                    className={cn(
                      "block cursor-pointer rounded-xl border border-dashed px-3 py-3.5 text-center transition-all",
                      isDragOver
                        ? "border-primary bg-primary/8 ring-2 ring-primary/20"
                        : "border-border bg-secondary hover:border-primary/40 hover:bg-secondary/80",
                      uploading && "pointer-events-none opacity-60"
                    )}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-[9px] transition-colors",
                        isDragOver ? "bg-primary/15 text-primary" : "bg-card text-muted-foreground"
                      )}>
                        {uploading
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5" />}
                      </div>
                      <div>
                        <p className={cn("text-[12px] font-medium", isDragOver ? "text-primary" : "text-foreground")}>
                          {uploading ? t.uploading : isDragOver ? t.panelDropActive : t.panelDropTitle}
                        </p>
                        <p className="mt-0.5 text-[10.5px] tracking-wide text-muted-foreground">
                          MD · TXT · PDF · DOC · DOCX
                        </p>
                      </div>
                    </div>
                  </label>

                  {/* Library */}
                  <div className="mt-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        {t.panelDocumentsLabel}
                      </p>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {(files.length === 1 ? t.panelFileCount : t.panelFileCountPlural).replace("{count}", String(files.length))}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                    {files.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
                        <p className="text-[12.5px] font-medium text-foreground">{t.panelEmptyTitle}</p>
                        <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">{t.panelEmptyDesc}</p>
                      </div>
                    ) : (
                      files.map((file) => {
                        const isParsing     = parsingIds.has(file.id)
                        const isUploading   = file.clientStatus === "uploading"
                        const isLoading     = isUploading || isParsing || file.status === "parsing"
                        const displayStatus = isUploading ? "uploading" : file.status
                        const canRetry      = !isUploading && file.status === "failed"

                        return (
                          <div
                            key={file.id}
                            className={cn(
                              "group relative overflow-hidden rounded-[10px] border p-2 transition-all hover:-translate-y-px mt-1",
                              isLoading
                                ? "border-primary/25 bg-primary/5"
                                : "border-border bg-card hover:bg-secondary"
                            )}
                          >
                            {/* Loading shimmer */}
                            {isLoading && (
                              <span className="file-card-loading-sweep pointer-events-none absolute inset-y-[-18%] left-[-52%] z-[1] w-[52%] rounded-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),rgba(255,255,255,0.85),rgba(255,255,255,0.18),transparent)] dark:bg-[linear-gradient(90deg,transparent,rgba(120,200,100,0.10),rgba(180,240,160,0.45),rgba(120,200,100,0.10),transparent)]" />
                            )}

                            <div className="relative z-10 flex items-center gap-2.5">
                              <FileExtBadge name={file.name} />
                              <div className="min-w-0 flex-1">
                                <p
                                  className="truncate font-mono text-[12.5px] font-medium text-foreground"
                                  title={file.name}
                                >
                                  {file.name}
                                </p>
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className="text-[10.5px] text-muted-foreground">{formatSize(file.size)}</span>
                                  <StatusBadge status={displayStatus} label={t.status[displayStatus as keyof typeof t.status] ?? displayStatus} />

                                  <div className="ml-auto flex items-center gap-1.5">
                                    {canRetry && (
                                      <button
                                        onClick={() => onParse(file.id)}
                                        disabled={isParsing}
                                        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[6px] border border-border bg-card px-2 text-[10.5px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                                      >
                                        {isParsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCode className="h-3 w-3" />}
                                        {isParsing ? t.retryingParse : t.retryParse}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { setDeleteFileId(file.id); setDeleteFileName(file.name) }}
                                      disabled={isUploading}
                                      className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-card text-muted-foreground transition-colors hover:border-destructive/30 hover:text-destructive disabled:opacity-50"
                                      aria-label={t.deleteFile}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete confirm dialog */}
      <Dialog open={deleteFileId !== null} onOpenChange={open => !open && handleCloseDeleteDialog()}>
        <DialogContent disableAnimation className="rounded-[1.1rem]">
          <DialogHeader>
            <DialogTitle>{t.confirmDeleteTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
              {t.confirmDeleteDesc.replace("{fileName}", deleteFileName)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDeleteDialog} className="rounded-lg">
              {t.confirmDeleteCancel}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} className="rounded-lg">
              {t.confirmDeleteAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
