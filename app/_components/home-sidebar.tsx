"use client"

import type { ComponentType } from "react"
import Link from "next/link"
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
import type { useLanguage } from "@/lib/i18n/LanguageContext"
import type { EvalTranslationKeys } from "@/lib/i18n/translations"

export type HomeSection = "workspace" | "public"

type EvalTab = "overview" | "compare" | "inspector" | "dataset"
type IconType = ComponentType<{ className?: string }>

type HomeSidebarProps = {
  activeSection: HomeSection
  onSelectSection: (section: HomeSection) => void
  onCreate: () => void
  userEmail?: string
  workspaceLabel: string
  t: ReturnType<typeof useLanguage>["home"]
  evalT: EvalTranslationKeys
}

function EvalLeafLink({ tab, label, icon: Icon }: { tab: EvalTab; label: string; icon: IconType }) {
  return (
    <Link href={`/eval?tab=${tab}`} className={navItemClass(false)}>
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  )
}

/**
 * Sidebar body (everything below the brand logo). Shared by the desktop
 * `<aside>` and the mobile drawer.
 */
export function HomeSidebarNav({
  activeSection,
  onSelectSection,
  onCreate,
  userEmail,
  workspaceLabel,
  t,
  evalT,
}: HomeSidebarProps) {
  const evaluateItems: { tab: EvalTab; label: string; icon: IconType }[] = [
    { tab: "overview", label: evalT.tabOverview, icon: LayoutDashboard },
    { tab: "compare", label: evalT.tabCompare, icon: GitCompare },
    { tab: "inspector", label: evalT.tabInspector, icon: ScanSearch },
  ]

  return (
    <SidebarBody footerTitle={userEmail ?? ""} footerSubtitle={workspaceLabel}>
      <Button onClick={onCreate} className="mb-2 w-full cursor-pointer rounded-lg">
        <Plus className="size-3.5" />
        {t.newKnowledgeBase}
      </Button>

      <SidebarSectionLabel>{t.navLabel}</SidebarSectionLabel>

      <button
        type="button"
        onClick={() => onSelectSection("workspace")}
        className={navItemClass(activeSection === "workspace")}
      >
        <FolderOpen className="h-4 w-4 shrink-0" />
        {t.navWorkspace}
      </button>
      <button
        type="button"
        onClick={() => onSelectSection("public")}
        className={navItemClass(activeSection === "public")}
      >
        <Globe className="h-4 w-4 shrink-0" />
        {t.publicKnowledgeBases}
      </button>

      <SidebarSectionLabel>{evalT.navSectionEvaluate}</SidebarSectionLabel>
      {evaluateItems.map((it) => (
        <EvalLeafLink key={it.tab} tab={it.tab} label={it.label} icon={it.icon} />
      ))}

      <SidebarSectionLabel>{evalT.navSectionManage}</SidebarSectionLabel>
      <EvalLeafLink tab="dataset" label={evalT.navDatasets} icon={Database} />
    </SidebarBody>
  )
}

/** Desktop sidebar — hidden below `md`, where {@link MobileNav} takes over. */
export function HomeSidebar(props: HomeSidebarProps) {
  return (
    <aside className="hidden bg-sidebar px-3 py-4 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-sidebar-border">
      <Link href="/" className="flex cursor-pointer items-center px-2 pb-4">
        <BrandLogo
          name={props.t.title}
          wordmarkAccent
          textClassName="truncate text-lg font-semibold tracking-[-0.04em] text-foreground"
        />
      </Link>
      <HomeSidebarNav {...props} />
    </aside>
  )
}
