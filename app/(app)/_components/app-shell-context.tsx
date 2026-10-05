"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { useLanguage } from "@/lib/i18n/LanguageContext"

export type HomeSection = "workspace" | "public"
export type EvalTab = "overview" | "compare" | "inspector" | "dataset"

/**
 * A one-shot request the sidebar (which lives in the shared layout) hands to the
 * home page, which owns the create dialog and the scrollable sections. The home
 * page consumes it and calls {@link AppShell.clearIntent}. Starts `null` and is
 * cleared after handling, so a fresh home mount (arriving from `/eval`) runs the
 * consuming effect once for a pending intent and never re-fires spuriously.
 */
export type ShellIntent =
  | null
  | { kind: "create" }
  | { kind: "section"; section: HomeSection }

type AppShell = {
  /** Footer subtitle, kept in sync by the home page; persists across `/ ↔ /eval`. */
  workspaceLabel: string
  setWorkspaceLabel: (label: string) => void
  /** Highlighted home section; only meaningful while on `/`. */
  activeSection: HomeSection
  setActiveSection: (section: HomeSection) => void
  /** Mirror of the eval page's URL-derived tab, kept in sync by the eval page so
   * the sidebar can highlight the active tab without reading search params in the
   * shared layout (which would force a Suspense boundary). Only read while on `/eval`. */
  evalTab: EvalTab
  setEvalTab: (tab: EvalTab) => void
  intent: ShellIntent
  requestIntent: (intent: ShellIntent) => void
  clearIntent: () => void
}

const AppShellContext = createContext<AppShell | null>(null)

export function AppShellProvider({ children }: { children: ReactNode }) {
  const { home } = useLanguage()
  const [workspaceLabel, setWorkspaceLabel] = useState(home.allWorkspaces)
  const [activeSection, setActiveSection] = useState<HomeSection>("workspace")
  const [evalTab, setEvalTab] = useState<EvalTab>("overview")
  const [intent, setIntent] = useState<ShellIntent>(null)

  const value = useMemo<AppShell>(
    () => ({
      workspaceLabel,
      setWorkspaceLabel,
      activeSection,
      setActiveSection,
      evalTab,
      setEvalTab,
      intent,
      requestIntent: setIntent,
      clearIntent: () => setIntent(null),
    }),
    [workspaceLabel, activeSection, evalTab, intent]
  )

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

export function useAppShell(): AppShell {
  const ctx = useContext(AppShellContext)
  if (!ctx) throw new Error("useAppShell must be used within AppShellProvider")
  return ctx
}
