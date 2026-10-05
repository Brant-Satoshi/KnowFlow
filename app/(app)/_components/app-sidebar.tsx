"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Database,
  FolderOpen,
  GitCompare,
  Globe,
  LayoutDashboard,
  Plus,
  ScanSearch,
} from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { SidebarBody, SidebarSectionLabel, navItemClass } from "@/components/app-sidebar"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth/AuthContext"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { useAppShell, type EvalTab, type HomeSection } from "./app-shell-context"

type IconType = ComponentType<{ className?: string }>

/**
 * Sidebar body (everything below the brand logo). Shared by the desktop
 * `<aside>` and the mobile drawer, and rendered by the shared `(app)` layout so
 * it persists across `/ ↔ /eval` navigation instead of remounting.
 *
 * `onNavigate` lets the mobile drawer close itself after an action.
 */
export function AppSidebarNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const { home: t, evalT } = useLanguage()
  const { workspaceLabel, activeSection, setActiveSection, evalTab, requestIntent } = useAppShell()

  const onHome = pathname === "/"
  const onEval = pathname === "/eval"

  const done = () => onNavigate?.()

  function handleCreate() {
    // The create dialog lives on the home page; hand it a one-shot intent and
    // (from /eval) navigate home so the page can consume it on mount.
    requestIntent({ kind: "create" })
    if (!onHome) router.push("/")
    done()
  }

  function selectSection(section: HomeSection) {
    setActiveSection(section)
    requestIntent({ kind: "section", section })
    if (!onHome) router.push("/")
    done()
  }

  function selectEvalTab(tab: EvalTab) {
    // On /eval, a query-only replace is a soft navigation: the eval page
    // re-renders the new tab without remounting, preserving its run state.
    if (onEval) router.replace(`/eval?tab=${tab}`, { scroll: false })
    else router.push(`/eval?tab=${tab}`)
    done()
  }

  const evaluateItems: { tab: EvalTab; label: string; icon: IconType }[] = [
    { tab: "overview", label: evalT.tabOverview, icon: LayoutDashboard },
    { tab: "compare", label: evalT.tabCompare, icon: GitCompare },
    { tab: "inspector", label: evalT.tabInspector, icon: ScanSearch },
  ]

  return (
    <SidebarBody footerTitle={user?.email ?? ""} footerSubtitle={workspaceLabel}>
      <Button onClick={handleCreate} className="mb-2 w-full cursor-pointer rounded-lg">
        <Plus className="size-3.5" />
        {t.newKnowledgeBase}
      </Button>

      <SidebarSectionLabel>{t.navLabel}</SidebarSectionLabel>
      <button
        type="button"
        onClick={() => selectSection("workspace")}
        className={navItemClass(onHome && activeSection === "workspace")}
      >
        <FolderOpen className="size-4 shrink-0" />
        {t.navWorkspace}
      </button>
      <button
        type="button"
        onClick={() => selectSection("public")}
        className={navItemClass(onHome && activeSection === "public")}
      >
        <Globe className="size-4 shrink-0" />
        {t.publicKnowledgeBases}
      </button>

      <SidebarSectionLabel>{evalT.navSectionEvaluate}</SidebarSectionLabel>
      {evaluateItems.map((it) => (
        <button
          key={it.tab}
          type="button"
          onClick={() => selectEvalTab(it.tab)}
          className={navItemClass(onEval && evalTab === it.tab)}
        >
          <it.icon className="size-4 shrink-0" />
          {it.label}
        </button>
      ))}

      <SidebarSectionLabel>{evalT.navSectionManage}</SidebarSectionLabel>
      <button
        type="button"
        onClick={() => selectEvalTab("dataset")}
        className={navItemClass(onEval && evalTab === "dataset")}
      >
        <Database className="size-4 shrink-0" />
        {evalT.navDatasets}
      </button>
    </SidebarBody>
  )
}

/** Desktop sidebar — hidden below `md`, where {@link MobileNav} takes over. */
export function AppSidebar() {
  const { home: t } = useLanguage()
  return (
    <aside className="hidden bg-sidebar px-3 py-4 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-sidebar-border">
      <Link href="/" className="flex cursor-pointer items-center px-2 pb-4">
        <BrandLogo
          name={t.title}
          wordmarkAccent
          textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
        />
      </Link>
      <AppSidebarNav />
    </aside>
  )
}
