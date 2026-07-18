"use client"

import { useCallback, useEffect, useState } from "react"
import { httpClient, HttpError } from "@/lib/http/client"
import type { ParseErrorCode } from "@/lib/rag/parse"
import { FileDoc, FileListItem } from "@/lib/types"
import { MAX_UPLOAD_FILE_BYTES } from "@/lib/validation"

type ErrorToast = (
  message?: string,
  options?: {
    title?: string
    description?: string
  }
) => void

/** Localized copy per ParseErrorCode — `t.parseErrors`. */
type ParseErrorMessages = Record<ParseErrorCode, string>

interface UseFileStateParams {
  knowledgeBaseId?: string
  showErrorToast: ErrorToast
  noKnowledgeBaseSelectedMessage: string
  uploadFailedMessage: string
  fileTooLargeMessage: string
  parseFailedMessage: string
  parseErrorMessages: ParseErrorMessages
  deleteFailedTitle: string
  deleteFailedDesc: string
}

function isParseErrorCode(
  value: unknown,
  messages: ParseErrorMessages,
): value is ParseErrorCode {
  return typeof value === "string" && value in messages
}

export function useFileState({
  knowledgeBaseId,
  showErrorToast,
  noKnowledgeBaseSelectedMessage,
  uploadFailedMessage,
  fileTooLargeMessage,
  parseFailedMessage,
  parseErrorMessages,
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
        // The server says *which* failure it was; say it in the user's language.
        // The English message on the error is the fallback for an older server.
        const code =
          error instanceof HttpError
            ? (error.data as { code?: unknown } | undefined)?.code
            : undefined
        const message = isParseErrorCode(code, parseErrorMessages)
          ? parseErrorMessages[code]
          : error instanceof Error
            ? error.message
            : parseFailedMessage

        showErrorToast(message)

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
    [knowledgeBaseId, parseErrorMessages, parseFailedMessage, refreshFiles, showErrorToast]
  )

  const handleUpload = useCallback(
    async (file: File) => {
      if (!knowledgeBaseId) {
        showErrorToast(noKnowledgeBaseSelectedMessage)
        return
      }

      if (file.size > MAX_UPLOAD_FILE_BYTES) {
        showErrorToast(fileTooLargeMessage)
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
      fileTooLargeMessage,
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
