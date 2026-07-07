"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { Menu } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * Mobile-only top bar (brand + hamburger) with a slide-in drawer for the
 * sidebar nav. Hidden at `md`+, where the page's own `<aside>` takes over.
 * `children` is a render prop receiving a `close` callback so nav actions can
 * dismiss the drawer.
 */
export function MobileNav({
  appName,
  menuLabel,
  navTitle,
  children,
}: {
  appName: string
  menuLabel: string
  navTitle: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 px-4 py-2.5 backdrop-blur md:hidden">
      <Link href="/" className="flex cursor-pointer items-center">
        <BrandLogo
          name={appName}
          wordmarkAccent
          textClassName="truncate text-base font-semibold tracking-[-0.04em] text-foreground"
        />
      </Link>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={menuLabel}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted/60"
          >
            <Menu className="h-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="w-72 p-0">
          <SheetTitle className="sr-only">{navTitle}</SheetTitle>
          <div className="flex h-full flex-col px-3 py-4">
            {children(() => setOpen(false))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
