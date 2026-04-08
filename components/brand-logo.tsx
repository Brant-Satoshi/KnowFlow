import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

type BrandLogoProps = {
  name: string
  className?: string
  iconClassName?: string
  textClassName?: string
}

export function BrandLogo({
  name,
  className,
  iconClassName,
  textClassName,
}: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_58%,#60a5fa_100%)] shadow-[0_16px_40px_-20px_rgba(15,23,42,0.85)] ring-1 ring-white/20 dark:ring-white/10",
          iconClassName
        )}
        aria-hidden="true"
      >
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.28),transparent_60%)]" />
        <span className="absolute inset-[7px] rounded-[10px] border border-white/16" />
        <Sparkles className="relative z-10 h-[18px] w-[18px] text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.28)]" strokeWidth={2.1} />
      </span>
      <span className={cn("truncate text-lg font-medium text-foreground", textClassName)}>{name}</span>
    </div>
  )
}
