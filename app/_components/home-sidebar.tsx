"use client"

import Link from "next/link"
import { FlaskConical, FolderOpen, Globe, Plus, Settings } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { SettingsMenu } from "@/components/settings-menu"
import { cn } from "@/lib/utils"
import type { useLanguage } from "@/lib/i18n/LanguageContext"

export type HomeSection = "workspace" | "public"

function navItemClass(active: boolean) {
  return cn(
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-sans transition-colors focus:outline-none",
    active
      ? "bg-primary/10 font-medium text-primary"
      : "text-sidebar-foreground/70 hover:bg-muted/60 hover:text-foreground"
  )
}

type HomeSidebarProps = {
  activeSection: HomeSection
  onSelectSection: (section: HomeSection) => void
  onCreate: () => void
  userEmail?: string
  workspaceLabel: string
  t: ReturnType<typeof useLanguage>["home"]
}

/**
 * Sidebar body (everything below the brand logo). Shared by the desktop
 * `<aside>` and the mobile drawer — `flex-1` so the user footer sinks to the
 * bottom of whichever container it fills.
 */
export function HomeSidebarNav({
  activeSection,
  onSelectSection,
  onCreate,
  userEmail,
  workspaceLabel,
  t,
}: HomeSidebarProps) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <Button onClick={onCreate} className="mb-2 w-full cursor-pointer rounded-lg">
        <Plus className="h-3.5 w-3.5" />
        {t.newKnowledgeBase}
      </Button>

      <div className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
        {t.navLabel}
      </div>

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
      <Link href="/eval" className={navItemClass(false)}>
        <FlaskConical className="h-4 w-4 shrink-0" />
        {t.evalEntry}
      </Link>
      <SettingsMenu
        side="right"
        align="start"
        trigger={
          <button type="button" className={navItemClass(false)}>
            <Settings className="h-4 w-4 shrink-0" />
            {t.navSettings}
          </button>
        }
      />

      <div className="flex-1" />

      <div className="flex items-center gap-2.5 border-t border-sidebar-border p-2">
        <span
          aria-hidden
          className="h-6.5 w-6.5 shrink-0 rounded-full"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)), color-mix(in srgb, hsl(var(--primary)) 70%, black))",
          }}
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-sans text-[12.5px] text-foreground">{userEmail}</div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">{workspaceLabel}</div>
        </div>
      </div>
    </div>
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
