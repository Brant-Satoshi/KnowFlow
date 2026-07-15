"use client"

import type { ReactNode } from "react"
import { MobileNav } from "@/components/mobile-nav"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { AppShellProvider } from "./app-shell-context"
import { AppSidebar, AppSidebarNav } from "./app-sidebar"

/**
 * Shared chrome for the `/` and `/eval` pages: renders the persistent sidebar
 * (desktop `<aside>` + mobile drawer) once, with the active page as the grid's
 * second column. Because this lives in the `(app)` layout, navigating between
 * `/` and `/eval` only swaps `children` — the sidebar instance never remounts.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { home: t } = useLanguage()
  return (
    <AppShellProvider>
      <div className="min-h-screen bg-background md:grid md:grid-cols-[232px_1fr]">
        <MobileNav appName={t.title} menuLabel={t.openMenu} navTitle={t.navLabel}>
          {(close) => <AppSidebarNav onNavigate={close} />}
        </MobileNav>
        <AppSidebar />
        {children}
      </div>
    </AppShellProvider>
  )
}
