"use client"

import { useSyncExternalStore } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useLanguage } from "@/lib/i18n/LanguageContext"

type ThemeMode = "light" | "dark" | "system"

const THEME_LABELS = {
  en: {
    light: "Light",
    dark: "Dark",
    system: "System",
    switcher: "Theme mode",
  },
  zh: {
    light: "白天",
    dark: "夜间",
    system: "系统",
    switcher: "主题模式",
  },
} as const

const emptySubscribe = () => () => {}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  const { language } = useLanguage()
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const labels = language === "zh" ? THEME_LABELS.zh : THEME_LABELS.en
  const currentTheme = mounted ? ((theme as ThemeMode | undefined) ?? "system") : "system"

  return (
    <ToggleGroup
      type="single"
      value={currentTheme}
      onValueChange={(value) => {
        if (value) {
          setTheme(value)
        }
      }}
      aria-label={labels.switcher}
      className="gap-1 rounded-lg border border-border bg-background/80 p-1 shadow-sm backdrop-blur"
    >
      <ToggleGroupItem
        value="light"
        size="sm"
        aria-label={labels.light}
        disabled={!mounted}
        className="h-8 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
      >
        <Sun className="h-3.5 w-3.5" />
        <span>{labels.light}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        size="sm"
        aria-label={labels.dark}
        disabled={!mounted}
        className="h-8 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
      >
        <Moon className="h-3.5 w-3.5" />
        <span>{labels.dark}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="system"
        size="sm"
        aria-label={labels.system}
        disabled={!mounted}
        className="h-8 rounded-md px-2.5 text-xs text-muted-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
      >
        <Monitor className="h-3.5 w-3.5" />
        <span>{labels.system}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
