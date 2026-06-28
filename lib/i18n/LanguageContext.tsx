"use client"

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { translations, type Language, type TranslationKeys, type EvalTranslationKeys, type AuthTranslationKeys } from "./translations"

type HomeTranslationKeys = typeof translations.en.home

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: TranslationKeys
  home: HomeTranslationKeys
  evalT: EvalTranslationKeys
  authT: AuthTranslationKeys
  isMounted: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
)

const STORAGE_KEY = "knowflow-language"
const emptySubscribe = () => () => {}

function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "en"
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh") return stored

  const browserLang = navigator.language.toLowerCase()
  if (browserLang.startsWith("zh")) return "zh"
  return "en"
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languageOverride, setLanguageOverride] = useState<Language | null>(null)
  const detectedLanguage = useSyncExternalStore<Language>(
    emptySubscribe,
    getInitialLanguage,
    () => "en"
  )
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const language: Language = languageOverride ?? detectedLanguage

  const setLanguage = (lang: Language) => {
    setLanguageOverride(lang)
    localStorage.setItem(STORAGE_KEY, lang)
  }

  const t = translations[language].chat
  const home = translations[language].home
  const evalT = translations[language].eval
  const authT = translations[language].auth

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, home, evalT, authT, isMounted: mounted }}>
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
