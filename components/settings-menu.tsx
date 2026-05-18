"use client"

import { useSyncExternalStore } from "react"
import { Globe, Monitor, Moon, Settings, Sun } from "lucide-react"
import { useThemeWithTransition } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/lib/i18n/LanguageContext"

type ThemeMode = "light" | "dark" | "system"

const LABELS = {
  en: {
    settings: "Settings",
    theme: "Theme",
    language: "Language",
    light: "Light",
    dark: "Dark",
    system: "System",
    english: "English",
    chinese: "Chinese",
  },
  zh: {
    settings: "设置",
    theme: "主题",
    language: "语言",
    light: "白天",
    dark: "夜间",
    system: "系统",
    english: "英文",
    chinese: "中文",
  },
} as const

const emptySubscribe = () => () => {}

export function SettingsMenu() {
  const { language, setLanguage } = useLanguage()
  const { theme, setTheme } = useThemeWithTransition()
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)
  const labels = language === "zh" ? LABELS.zh : LABELS.en
  const currentTheme = mounted ? ((theme as ThemeMode | undefined) ?? "system") : "system"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 px-2 sm:px-3">
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">{labels.settings}</span>
          <span className="sr-only sm:hidden">{labels.settings}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl p-2">
        <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {labels.theme}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={currentTheme}
          onValueChange={(value) => {
            if (value === "light" || value === "dark" || value === "system") {
              setTheme(value)
            }
          }}
        >
          <DropdownMenuRadioItem value="light" className="gap-2 rounded-md">
            <Sun className="h-4 w-4" />
            {labels.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className="gap-2 rounded-md">
            <Moon className="h-4 w-4" />
            {labels.dark}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className="gap-2 rounded-md">
            <Monitor className="h-4 w-4" />
            {labels.system}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuLabel className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {labels.language}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(value) => {
            if (value === "en" || value === "zh") {
              setLanguage(value)
            }
          }}
        >
          <DropdownMenuRadioItem value="en" className="gap-2 rounded-md">
            <Globe className="h-4 w-4" />
            {labels.english}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh" className="gap-2 rounded-md">
            <Globe className="h-4 w-4" />
            {labels.chinese}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
