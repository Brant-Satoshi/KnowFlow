"use client"

import { useCallback, useEffect, useState } from "react"
import { FileDoc } from "@/lib/types"

type ErrorToast = (message?: string) => void

interface UseFileStateParams {
  knowledgeBaseId?: string
  showErrorToast: ErrorToast
  noKnowledgeBaseSelectedMessage: string
  uploadFailedMessage: string
  parseFailedMessage: string
  deleteFailedMessage: string
}

export function useFileState({
  knowledgeBaseId,
  showErrorToast,
  noKnowledgeBaseSelectedMessage,
  uploadFailedMessage,
  parseFailedMessage,
  deleteFailedMessage,
}: UseFileStateParams) {
  const [files, setFiles] = useState<FileDoc[]>([])
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set())

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

  const handleUpload = useCallback(
    async (file: File) => {
      if (!knowledgeBaseId) {
        showErrorToast(noKnowledgeBaseSelectedMessage)
        return
      }

      setUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("knowledgeBaseId", knowledgeBaseId)

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        })
        const json = await res.json()
        if (json.ok) {
          setFiles((prev) => [...prev, json.data.file])
        } else {
          showErrorToast(json.error || uploadFailedMessage)
        }
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : uploadFailedMessage)
      } finally {
        setUploading(false)
      }
    },
    [knowledgeBaseId, noKnowledgeBaseSelectedMessage, showErrorToast, uploadFailedMessage]
  )

  const handleParse = useCallback(
    async (id: string) => {
      setParsingIds((prev) => new Set(prev).add(id))

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

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/files/${id}`, { method: "DELETE" })
        const json = await res.json()
        if (json.ok) {
          setFiles((prev) => prev.filter((file) => file.id !== id))
        } else {
          showErrorToast(json.error || deleteFailedMessage)
        }
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : deleteFailedMessage)
      }
    },
    [deleteFailedMessage, showErrorToast]
  )

  return {
    files,
    uploading,
    parsingIds,
    isInitialLoading,
    handleUpload,
    handleParse,
    handleDelete,
  }
}
