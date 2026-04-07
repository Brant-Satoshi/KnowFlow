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
        <span className="absolute inset-[7px] rounded-[10px] border border-white/20" />
        <span className="absolute left-[9px] top-[9px] h-2.5 w-2.5 rounded-full bg-white/95" />
        <span className="absolute bottom-[9px] right-[9px] h-2.5 w-2.5 rounded-full bg-[#fde68a]" />
        <span className="absolute h-[2px] w-6 rotate-[-45deg] rounded-full bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.4)]" />
      </span>
      <span className={cn("truncate text-lg font-medium text-foreground", textClassName)}>{name}</span>
    </div>
  )
}
