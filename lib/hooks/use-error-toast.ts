"use client"

import { useCallback } from "react"
import { toast } from "@/components/ui/use-toast"
import { useLanguage } from "@/lib/i18n/LanguageContext"

export function useErrorToast() {
  const { t } = useLanguage()

  return useCallback(
  (message?: string) =>
    toast({
      variant: "destructive",
      description: message || t.commonError,
    }),
  [t]
)
}
