"use client"

import { useCallback, useEffect, useState } from "react"
import { httpClient } from "@/lib/http/client"
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
}

export function useFileState({
  knowledgeBaseId,
  showErrorToast,
  noKnowledgeBaseSelectedMessage,
  uploadFailedMessage,
  parseFailedMessage,
  deleteFailedTitle,
  deleteFailedDesc,
}: UseFileStateParams) {
  const [files, setFiles] = useState<FileDoc[]>([])
  const [optimisticFiles, setOptimisticFiles] = useState<FileListItem[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set())

  const refreshFiles = useCallback(async () => {
    const data = await httpClient.get<{ files: FileDoc[] }>(
      `/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId || "")}`
    )
    setFiles(data.files)
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
        const data = await httpClient.post<{ file: FileDoc }>(`/api/files/${id}/parse`, undefined)
        setFiles((prev) => prev.map((file) => (file.id === id ? data.file : file)))
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

        const data = await httpClient.post<{ file: FileDoc }>("/api/files/upload", formData)
        setOptimisticFiles((prev) => prev.filter((item) => item.id !== optimisticId))
        const nextFile: FileDoc = {
          ...data.file,
          status: "parsing",
        }
        setFiles((prev) => [nextFile, ...prev])
        void handleParse(nextFile.id)
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
    (id: string) => {
      let snapshot: FileDoc[] = []

      setFiles((prev) => {
        snapshot = [...prev]
        return prev.filter((file) => file.id !== id)
      })

      httpClient.delete(`/api/files/${id}`).catch(() => {
        setFiles(snapshot)
        showErrorToast(undefined, { title: deleteFailedTitle, description: deleteFailedDesc })
      })
    },
    [
      deleteFailedDesc,
      deleteFailedTitle,
      showErrorToast,
    ]
  )

  return {
    files: [...optimisticFiles, ...files],
    uploading,
    parsingIds,
    isInitialLoading,
    handleUpload,
    handleParse,
    handleDelete,
  }
}
