"use client"

import type { ReactNode } from "react"
import { SettingsMenu } from "@/components/settings-menu"
import { cn } from "@/lib/utils"

export function navItemClass(active: boolean) {
  return cn(
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-sans transition-colors focus:outline-none",
    active
      ? "bg-primary/10 font-medium text-primary"
      : "text-sidebar-foreground/70 hover:bg-muted/60 hover:text-foreground"
  )
}

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
      {children}
    </div>
  )
}

/**
 * Shared sidebar body: nav children followed by a bottom user/context footer
 * (gradient avatar, title/subtitle, settings). Rendered inside both the desktop
 * `<aside>` wrappers and the mobile drawer, on both the home and eval pages.
 * `flex-1` sinks the footer to the bottom of whichever container it fills.
 */
export function SidebarBody({
  children,
  footerTitle,
  footerSubtitle,
}: {
  children: ReactNode
  footerTitle: string
  footerSubtitle: string
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      {children}

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
          <div className="truncate font-sans text-[12.5px] text-foreground">{footerTitle}</div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">{footerSubtitle}</div>
        </div>
        <SettingsMenu side="top" align="start" />
      </div>
    </div>
  )
}
