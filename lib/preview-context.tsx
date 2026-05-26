"use client"

import { createContext, useContext } from "react"

export interface OpenPreviewArgs {
  fileId: string
  fileName: string
  chunkId?: string
}

export type OpenPreview = (args: OpenPreviewArgs) => void

export const PreviewContext = createContext<OpenPreview | null>(null)

export function useOpenPreview(): OpenPreview | null {
  return useContext(PreviewContext)
}
