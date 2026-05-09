"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "@/components/ui/use-toast"
import { FileDoc, FileListItem } from "@/lib/types"

type ErrorToast = (
  message?: string,
  options?: {
    title?: string
    description?: string
  }
) => void

interface UseFileStateParams {
  knowledgeBaseId?: string
  showErrorToast: ErrorToast
  noKnowledgeBaseSelectedMessage: string
  uploadFailedMessage: string
  parseFailedMessage: string
  deleteFailedTitle: string
  deleteFailedDesc: string
  deleteSuccessTitle: string
  deleteSuccessDesc: string
}

export function useFileState({
  knowledgeBaseId,
  showErrorToast,
  noKnowledgeBaseSelectedMessage,
  uploadFailedMessage,
  parseFailedMessage,
  deleteFailedTitle,
  deleteFailedDesc,
  deleteSuccessTitle,
  deleteSuccessDesc,
}: UseFileStateParams) {
  const [files, setFiles] = useState<FileDoc[]>([])
  const [optimisticFiles, setOptimisticFiles] = useState<FileListItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const refreshFiles = useCallback(async () => {
    const res = await fetch(`/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId || "")}`)
    const json = await res.json()
    if (json.ok) {
      setFiles(json.data.files)
    }
  }, [knowledgeBaseId])

  const fetchFiles = useCallback(async () => {
    if (!knowledgeBaseId) {
      setIsInitialLoading(false)
      return
    }

    try {
      await refreshFiles()
    } catch (error) {
      console.error("Failed to fetch files:", error)
    } finally {
      setIsInitialLoading(false)
    }
  }, [knowledgeBaseId, refreshFiles])

  useEffect(() => {
    void fetchFiles()
  }, [fetchFiles])

  const handleParse = useCallback(
    async (id: string) => {
      setParsingIds((prev) => new Set(prev).add(id))
      setFiles((prev) =>
        prev.map((file) => (file.id === id ? { ...file, status: "parsing" } : file))
      )

      try {
        const res = await fetch(`/api/files/${id}/parse`, { method: "POST" })
        const json = await res.json()

        if (json.ok && json.data?.file) {
          setFiles((prev) => prev.map((file) => (file.id === id ? json.data.file : file)))
        } else {
          showErrorToast(json.error || parseFailedMessage)
          await refreshFiles()
        }
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : parseFailedMessage)

        if (knowledgeBaseId) {
          await refreshFiles()
        }
      } finally {
        setParsingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [knowledgeBaseId, parseFailedMessage, refreshFiles, showErrorToast]
  )

  const handleUpload = useCallback(
    async (file: File) => {
      if (!knowledgeBaseId) {
        showErrorToast(noKnowledgeBaseSelectedMessage)
        return
      }

      setUploading(true)
      const optimisticId = `uploading-${crypto.randomUUID()}`
      const optimisticFile: FileListItem = {
        id: optimisticId,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        status: "uploaded",
        clientStatus: "uploading",
        createdAt: new Date().toISOString(),
        knowledgeBaseId,
      }

      setOptimisticFiles((prev) => [optimisticFile, ...prev])

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("knowledgeBaseId", knowledgeBaseId)

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        })
        const json = await res.json()
        if (json.ok && json.data?.file) {
          setOptimisticFiles((prev) => prev.filter((item) => item.id !== optimisticId))
          const nextFile: FileDoc = {
            ...json.data.file,
            status: "parsing",
          }
          setFiles((prev) => [nextFile, ...prev])
          void handleParse(nextFile.id)
        } else {
          setOptimisticFiles((prev) => prev.filter((item) => item.id !== optimisticId))
          showErrorToast(json.error || uploadFailedMessage)
        }
      } catch (error) {
        setOptimisticFiles((prev) => prev.filter((item) => item.id !== optimisticId))
        showErrorToast(error instanceof Error ? error.message : uploadFailedMessage)
      } finally {
        setUploading(false)
      }
    },
    [
      handleParse,
      knowledgeBaseId,
      noKnowledgeBaseSelectedMessage,
      showErrorToast,
      uploadFailedMessage,
    ]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const snapshot = [...files]

      setFiles((prev) => prev.filter((file) => file.id !== id))
      setDeletingIds((prev) => new Set(prev).add(id))

      fetch(`/api/files/${id}`, { method: "DELETE" })
        .then((res) => res.json())
        .then((json) => {
          if (!json.ok) throw new Error()
          toast({ title: deleteSuccessTitle, description: deleteSuccessDesc, variant: "success" })
        })
        .catch(() => {
          setFiles(snapshot)
          showErrorToast(undefined, { title: deleteFailedTitle, description: deleteFailedDesc })
        })
        .finally(() => {
          setDeletingIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        })

      return true
    },
    [
      deleteFailedDesc,
      deleteFailedTitle,
      deleteSuccessDesc,
      deleteSuccessTitle,
      files,
      showErrorToast,
    ]
  )

  return {
    files: [...optimisticFiles, ...files],
    uploading,
    parsingIds,
    deletingIds,
    isInitialLoading,
    handleUpload,
    handleParse,
    handleDelete,
  }
}
