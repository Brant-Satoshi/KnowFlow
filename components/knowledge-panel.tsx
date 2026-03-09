"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { FileText, ChevronLeft, ChevronRight, Upload, Trash2, FileCode, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileDoc } from "@/lib/types"

interface KnowledgePanelProps {
  files: FileDoc[]
  onUpload: (file: File) => void
  onParse: (id: string) => void
  onDelete: (id: string) => void
  parsingIds: Set<string>
  uploading: boolean
  collapsed: boolean
  onToggle: () => void
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

export function KnowledgePanel({
  files,
  onUpload,
  onParse,
  onDelete,
  parsingIds,
  uploading,
  collapsed,
  onToggle,
}: KnowledgePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        onUpload(file)
      }
      // Reset input
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

  return (
    <div
      className={cn(
        "flex flex-col border-r border-border bg-card transition-all duration-300 ease-in-out",
        collapsed ? "w-12" : "w-80"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border p-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Knowledge Base</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {files.length}
            </span>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {collapsed ? null : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Upload Button */}
          <div className="border-b border-border p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.pdf"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
              id="panel-file-upload"
            />
            <label
              htmlFor="panel-file-upload"
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary",
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
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>Upload File</span>
                </>
              )}
            </label>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Supports .md, .txt, .pdf
            </p>
          </div>

          {/* File List */}
          <div className="flex-1 overflow-y-auto p-2">
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText className="mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No files uploaded yet</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Upload files to build your knowledge base
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {files.map((file) => {
                  const isParsing = parsingIds.has(file.id)
                  return (
                    <div
                      key={file.id}
                      className="group flex items-start gap-2 rounded-lg border border-border p-2 transition-colors hover:bg-secondary"
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
                            {file.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {file.status === "uploaded" && (
                          <button
                            onClick={() => onParse(file.id)}
                            disabled={isParsing}
                            className="rounded p-1 text-muted-foreground hover:text-primary disabled:pointer-events-none"
                            title="Parse file"
                          >
                            {isParsing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileCode className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(file.id)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                          title="Delete file"
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
        </div>
      )}
    </div>
  )
}
