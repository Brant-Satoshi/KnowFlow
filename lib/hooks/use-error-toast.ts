"use client"

import { useCallback } from "react"
import { toast } from "@/components/ui/use-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"

interface ErrorToastOptions {
  title?: string
  description?: string
}

export function useErrorToast() {
  const { t } = useLanguage()

  return useCallback(
    (message?: string, options?: ErrorToastOptions) =>
      toast({
        variant: "destructive",
        title: options?.title,
        description: message || options?.description || t.commonError,
      }),
    [t]
  )
}
