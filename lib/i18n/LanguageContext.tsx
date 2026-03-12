"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react"
import { translations, type Language, type TranslationKeys } from "./translations"

type HomeTranslationKeys = typeof translations.en.home

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: TranslationKeys
  home: HomeTranslationKeys
  isMounted: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
)

const STORAGE_KEY = "askbase-language"

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "en"
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh") return stored

  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith("zh")) return "zh"
  return "en"
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setLanguageState(getInitialLanguage())
    setMounted(true)
  }, [])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem(STORAGE_KEY, lang)
  }

  const t = translations[language].chat
  const home = translations[language].home

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, home, isMounted: mounted }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}
