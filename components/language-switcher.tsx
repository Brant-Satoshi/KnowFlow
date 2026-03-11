"use client"

import { useLanguage } from "@/lib/i18n/LanguageContext"
import { Button } from "@/components/ui/button"

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage()

  const toggle = () => {
    setLanguage(language === "en" ? "zh" : "en")
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="h-8 gap-1.5 px-2.5 text-sm"
    >
      <span className="text-[10px] leading-none opacity/60">🌐</span>
      <span>{language === "en" ? "EN" : "中"}</span>
    </Button>
  )
}
