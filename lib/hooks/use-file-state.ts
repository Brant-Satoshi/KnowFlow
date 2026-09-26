"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { formatFileNameList } from "@/lib/format"
import { httpClient, HttpError } from "@/lib/http/client"
import type { ParseErrorCode } from "@/lib/rag/parse"
import { createTaskQueue, type TaskQueue } from "@/lib/task-queue"
import { FileDoc, FileListItem } from "@/lib/types"
import { triageUploadFiles } from "@/lib/validation"

type ErrorToast = (
  message?: string,
  options?: {
    title?: string
    description?: string
  }
) => void

/** Localized copy per ParseErrorCode — `t.parseErrors`. */
type ParseErrorMessages = Record<ParseErrorCode, string>

/**
 * Files of a batch in flight at once. A slot carries one file through upload
 * *and* parse, so this also bounds concurrent parse (embedding) runs, and it
 * leaves the chat's SSE stream room within the browser's six connections per
 * origin.
 */
const UPLOAD_CONCURRENCY = 3

/** Files of the running batch that are done (indexed or failed) out of all it holds. */
export interface UploadBatchProgress {
  completed: number
  total: number
}

interface UploadJob {
  /** Id of the file's placeholder row; stays the same across retries. */
  rowId: string
  file: File
  knowledgeBaseId: string
}

/** A file with no server row yet. The File is kept so a failed upload can be retried. */
interface PendingUpload {
  file: File
  state: "queued" | "uploading" | "failed"
}

interface UseFileStateParams {
  knowledgeBaseId?: string
  showErrorToast: ErrorToast
  noKnowledgeBaseSelectedMessage: string
  uploadFailedMessage: string
  parseFailedMessage: string
  parseErrorMessages: ParseErrorMessages
  deleteFailedTitle: string
  deleteFailedDesc: string
  /** Title of the toast listing files a selection skipped; `{count}` is replaced. */
  skippedTitle: string
  skippedTitlePlural: string
  /** One line of that toast per reason; `{names}` is replaced. */
  skippedUnsupportedMessage: string
  skippedTooLargeMessage: string
  /** Shown, and nothing uploaded, when a selection is over MAX_UPLOAD_BATCH_FILES. */
  tooManyFilesMessage: string
}

function isParseErrorCode(
  value: unknown,
  messages: ParseErrorMessages,
): value is ParseErrorCode {
  return typeof value === "string" && value in messages
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

export function useFileState({
  knowledgeBaseId,
  showErrorToast,
  noKnowledgeBaseSelectedMessage,
  uploadFailedMessage,
  parseFailedMessage,
  parseErrorMessages,
  deleteFailedTitle,
  deleteFailedDesc,
  skippedTitle,
  skippedTitlePlural,
  skippedUnsupportedMessage,
  skippedTooLargeMessage,
  tooManyFilesMessage,
}: UseFileStateParams) {
  const [files, setFiles] = useState<FileDoc[]>([])
  // Rows with no server file behind them yet: queued, uploading, or failed to upload.
  const [optimisticFiles, setOptimisticFiles] = useState<FileListItem[]>([])
  // Why a file's last parse failed, by file id. The server keeps only the status,
  // and toasts replace each other, so in a batch this is where the reason lives.
  const [parseFailures, setParseFailures] = useState<Record<string, string>>({})
  const [batchProgress, setBatchProgress] = useState<UploadBatchProgress | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [parsingIds, setParsingIds] = useState<Set<string>>(new Set())

  // The queue is mutable and outlives renders, so it sits in refs rather than
  // state, alongside the File objects behind rows that aren't uploaded yet.
  const queueRef = useRef<TaskQueue<UploadJob> | null>(null)
  const pendingUploadsRef = useRef(new Map<string, PendingUpload>())
  const runUploadJobRef = useRef<(job: UploadJob) => Promise<void>>(async () => {})

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

  /**
   * Re-read one file after a failed parse. Only its row is touched: other files
   * of the same batch may have landed since, and replacing the whole list with
   * an older snapshot would drop them from view.
   */
  const syncFileRow = useCallback(
    async (id: string) => {
      if (!knowledgeBaseId) return
      try {
        const data = await httpClient.get<{ files: FileDoc[] }>(
          `/api/files?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`
        )
        const fresh = data.files.find((file) => file.id === id)
        setFiles((prev) =>
          fresh
            ? prev.map((file) => (file.id === id ? fresh : file))
            : prev.filter((file) => file.id !== id)
        )
      } catch {
        // The parse request itself failed, so failed (and retryable) is the honest guess.
        setFiles((prev) =>
          prev.map((file) => (file.id === id ? { ...file, status: "failed" } : file))
        )
      }
    },
    [knowledgeBaseId]
  )

  /** Parse one file. Resolves to why it failed (localized), or null once it's indexed. */
  const runParse = useCallback(
    async (id: string): Promise<string | null> => {
      setParsingIds((prev) => new Set(prev).add(id))
      setParseFailures((prev) => withoutKey(prev, id))
      setFiles((prev) =>
        prev.map((file) => (file.id === id ? { ...file, status: "parsing" } : file))
      )

      try {
        const data = await httpClient.post<{ file: FileDoc }>(`/api/files/${id}/parse`, undefined)
        setFiles((prev) => prev.map((file) => (file.id === id ? data.file : file)))
        return null
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

        setParseFailures((prev) => ({ ...prev, [id]: message }))
        await syncFileRow(id)
        return message
      } finally {
        setParsingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [parseErrorMessages, parseFailedMessage, syncFileRow]
  )

  const handleParse = useCallback(
    async (id: string) => {
      const message = await runParse(id)
      if (message) showErrorToast(message)
    },
    [runParse, showErrorToast]
  )

  /** Upload one queued file. Resolves to its server row, or null after marking the row failed. */
  const uploadQueuedFile = useCallback(
    async ({ rowId, file, knowledgeBaseId: targetKnowledgeBaseId }: UploadJob) => {
      const pending = pendingUploadsRef.current.get(rowId)
      if (pending) pending.state = "uploading"
      setOptimisticFiles((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, clientStatus: "uploading", errorMessage: undefined } : row
        )
      )

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("knowledgeBaseId", targetKnowledgeBaseId)
        const data = await httpClient.post<{ file: FileDoc }>("/api/files/upload", formData)

        pendingUploadsRef.current.delete(rowId)
        setOptimisticFiles((prev) => prev.filter((row) => row.id !== rowId))
        setFiles((prev) => [{ ...data.file, status: "parsing" }, ...prev])
        return data.file
      } catch (error) {
        // The route's own message says what was wrong (type, size, storage);
        // a dropped connection has nothing useful to say, so it gets the generic line.
        const message = error instanceof HttpError ? error.message : uploadFailedMessage
        if (pending) pending.state = "failed"
        setOptimisticFiles((prev) =>
          prev.map((row) =>
            row.id === rowId ? { ...row, clientStatus: "upload_failed", errorMessage: message } : row
          )
        )
        showErrorToast(message, { title: file.name })
        return null
      }
    },
    [showErrorToast, uploadFailedMessage]
  )

  // One queue slot: upload, then parse right away — a file is never left sitting
  // in "uploaded", which has no retry button.
  const runUploadJob = useCallback(
    async (job: UploadJob) => {
      try {
        const uploaded = await uploadQueuedFile(job)
        if (!uploaded) return
        const parseError = await runParse(uploaded.id)
        if (parseError) showErrorToast(parseError, { title: job.file.name })
      } finally {
        setBatchProgress((prev) => prev && { ...prev, completed: prev.completed + 1 })
      }
    },
    [runParse, showErrorToast, uploadQueuedFile]
  )

  // The queue holds on to the function it was created with; route it to the latest one.
  useEffect(() => {
    runUploadJobRef.current = runUploadJob
  }, [runUploadJob])

  const getUploadQueue = useCallback(() => {
    if (!queueRef.current) {
      queueRef.current = createTaskQueue<UploadJob>({
        concurrency: UPLOAD_CONCURRENCY,
        run: (job) => runUploadJobRef.current(job),
        onIdle: () => setBatchProgress(null),
      })
    }
    return queueRef.current
  }, [])

  const handleUpload = useCallback(
    (selected: readonly File[]) => {
      if (selected.length === 0) return
      if (!knowledgeBaseId) {
        showErrorToast(noKnowledgeBaseSelectedMessage)
        return
      }

      const triage = triageUploadFiles(selected)
      if (!triage.ok) {
        showErrorToast(tooManyFilesMessage)
        return
      }

      // Files the route would refuse anyway are never sent. They also never get
      // a row, so this one toast is the only place they're named.
      if (triage.rejected.length > 0) {
        const namesWith = (reason: "unsupported_type" | "too_large") =>
          formatFileNameList(
            triage.rejected.filter((item) => item.reason === reason).map((item) => item.name)
          )
        const lines: string[] = []
        if (triage.rejected.some((item) => item.reason === "unsupported_type")) {
          lines.push(skippedUnsupportedMessage.replace("{names}", namesWith("unsupported_type")))
        }
        if (triage.rejected.some((item) => item.reason === "too_large")) {
          lines.push(skippedTooLargeMessage.replace("{names}", namesWith("too_large")))
        }
        const count = triage.rejected.length
        showErrorToast(lines.join("\n"), {
          title: (count === 1 ? skippedTitle : skippedTitlePlural).replace("{count}", String(count)),
        })
      }

      if (triage.accepted.length === 0) return

      const jobs = triage.accepted.map(
        (file): UploadJob => ({ rowId: `upload-${crypto.randomUUID()}`, file, knowledgeBaseId })
      )
      const createdAt = new Date().toISOString()
      for (const job of jobs) {
        pendingUploadsRef.current.set(job.rowId, { file: job.file, state: "queued" })
      }
      // In selection order, above everything else — the order the queue will take them.
      setOptimisticFiles((prev) => [
        ...jobs.map(
          (job): FileListItem => ({
            id: job.rowId,
            name: job.file.name,
            type: job.file.type || "application/octet-stream",
            size: job.file.size,
            status: "uploaded",
            clientStatus: "queued",
            createdAt,
            knowledgeBaseId,
          })
        ),
        ...prev,
      ])
      setBatchProgress((prev) => ({
        completed: prev?.completed ?? 0,
        total: (prev?.total ?? 0) + jobs.length,
      }))
      getUploadQueue().push(...jobs)
    },
    [
      getUploadQueue,
      knowledgeBaseId,
      noKnowledgeBaseSelectedMessage,
      showErrorToast,
      skippedTitle,
      skippedTitlePlural,
      skippedTooLargeMessage,
      skippedUnsupportedMessage,
      tooManyFilesMessage,
    ]
  )

  const handleRetryUpload = useCallback(
    (rowId: string) => {
      const pending = pendingUploadsRef.current.get(rowId)
      if (!pending || pending.state !== "failed" || !knowledgeBaseId) return

      pending.state = "queued"
      setOptimisticFiles((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, clientStatus: "queued", errorMessage: undefined } : row
        )
      )
      setBatchProgress((prev) => ({
        completed: prev?.completed ?? 0,
        total: (prev?.total ?? 0) + 1,
      }))
      getUploadQueue().push({ rowId, file: pending.file, knowledgeBaseId })
    },
    [getUploadQueue, knowledgeBaseId]
  )

  /** Take a queued file out of the batch, or clear a failed upload's row. Nothing to undo server-side. */
  const handleDiscardUpload = useCallback((rowId: string) => {
    const pending = pendingUploadsRef.current.get(rowId)
    if (!pending || pending.state === "uploading") return

    if (pending.state === "queued") {
      // A file that was just handed a slot can't be pulled back; it uploads
      // and its row updates itself.
      if (!queueRef.current?.remove((job) => job.rowId === rowId)) return
      setBatchProgress((prev) => prev && { ...prev, total: prev.total - 1 })
    }

    pendingUploadsRef.current.delete(rowId)
    setOptimisticFiles((prev) => prev.filter((row) => row.id !== rowId))
  }, [])

  // Closing or reloading the tab loses every file not uploaded yet — warn first.
  const hasUnsentFiles = optimisticFiles.some(
    (row) => row.clientStatus === "queued" || row.clientStatus === "uploading"
  )
  useEffect(() => {
    if (!hasUnsentFiles) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers only prompt when returnValue is set.
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [hasUnsentFiles])

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
    files: [
      ...optimisticFiles,
      ...files.map((file): FileListItem =>
        file.status === "failed" && parseFailures[file.id]
          ? { ...file, errorMessage: parseFailures[file.id] }
          : file
      ),
    ],
    uploading: batchProgress !== null,
    batchProgress,
    parsingIds,
    isInitialLoading,
    handleUpload,
    handleRetryUpload,
    handleDiscardUpload,
    handleParse,
    handleDelete,
  }
}
