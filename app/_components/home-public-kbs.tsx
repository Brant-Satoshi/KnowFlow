"use client"

import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import type { useLanguage } from "@/lib/i18n/LanguageContext"
import type { Language } from "@/lib/i18n/translations"
import { formatDate } from "@/lib/format"

type HomeT = ReturnType<typeof useLanguage>["home"]

// Placeholder catalog until the public-KB backend (visibility + clone API) ships.
const PUBLIC_KBS = [
  { id: "help-center", nameKey: "publicKb1Name", descKey: "publicKb1Desc", badge: "official", maintainer: "KnowFlow Team", updatedAt: "2026-07-01", accent: 0 },
  { id: "llm-papers", nameKey: "publicKb2Name", descKey: "publicKb2Desc", badge: "community", maintainer: "@ml-reading-group", updatedAt: "2026-06-28", accent: 3 },
  { id: "oss-licenses", nameKey: "publicKb3Name", descKey: "publicKb3Desc", badge: "community", maintainer: "@oss-legal", updatedAt: "2026-06-15", accent: 4 },
  { id: "industry-research", nameKey: "publicKb4Name", descKey: "publicKb4Desc", badge: "official", maintainer: "KnowFlow Research", updatedAt: "2026-05-30", accent: 2 },
] as const satisfies readonly {
  id: string
  nameKey: keyof HomeT
  descKey: keyof HomeT
  badge: "official" | "community"
  maintainer: string
  updatedAt: string
  accent: number
}[]

export function PublicKnowledgeBases({
  t,
  language,
}: {
  t: HomeT
  language: Language
}) {
  const showComingSoon = () =>
    toast({ title: t.comingSoonTitle, description: t.comingSoonDesc })

  return (
    <section id="public-knowledge-bases" className="scroll-mt-10">
      <div className="mb-1.5 flex items-baseline gap-3.5">
        <h2 className="font-sans text-xl font-semibold tracking-[-0.01em] text-foreground">
          {t.publicKnowledgeBases}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {t.kbCountLabel.replace("{count}", String(PUBLIC_KBS.length))}
        </span>
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">{t.publicKbSectionDesc}</p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
        {PUBLIC_KBS.map((kb) => {
          const name = t[kb.nameKey]
          const accentVar = `var(--card-accent-${kb.accent})`
          return (
            <div
              key={kb.id}
              className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-[0_4px_16px_rgba(0,0,0,0.07)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[9px] text-[15px] font-bold"
                  style={{
                    color: accentVar,
                    background: `color-mix(in srgb, ${accentVar} 14%, transparent)`,
                  }}
                >
                  {name.charAt(0)}
                </div>
                <p className="min-w-0 flex-1 truncate font-sans text-base font-semibold tracking-[-0.01em] text-foreground">
                  {name}
                </p>
                <span
                  className={
                    kb.badge === "official"
                      ? "shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] text-primary"
                      : "shrink-0 rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                  }
                >
                  {kb.badge === "official" ? t.badgeOfficial : t.badgeCommunity}
                </span>
              </div>

              <p className="flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {t[kb.descKey]}
              </p>

              <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="truncate">{kb.maintainer}</span>
                <span className="h-0.75 w-0.75 shrink-0 rounded-full bg-border" />
                {/* These cards are SSR'd: format with the app-language locale (not the
                    browser's) and in UTC — updatedAt is a calendar date parsed as UTC
                    midnight — so server and client HTML never diverge at hydration. */}
                <span className="shrink-0">{`${t.updatedLabel} ${formatDate(kb.updatedAt, language, { utc: true })}`}</span>
              </div>

              <div className="mt-1 flex gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 cursor-pointer"
                  onClick={showComingSoon}
                >
                  {t.browseAction}
                </Button>
                <Button
                  size="sm"
                  className="flex-1 cursor-pointer bg-primary/10 text-primary shadow-none hover:bg-primary/15"
                  onClick={showComingSoon}
                >
                  <Copy className="h-3 w-3" />
                  {t.cloneAction}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
