import { cn } from "@/lib/utils"

type BrandLogoProps = {
  name: string
  className?: string
  textClassName?: string
  iconSize?: number
}

export function BrandLogo({ name, className, textClassName, iconSize = 34 }: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="64" height="64" rx="16" className="fill-primary" />
        {/* Stem */}
        <line
          x1="20" y1="14" x2="20" y2="50"
          stroke="white" strokeWidth="5.5" strokeLinecap="round"
        />
        {/* Loop */}
        <path
          d="M20 14 H33 Q44 14 44 25 Q44 36 33 36 H20"
          stroke="white" strokeWidth="5.5"
          strokeLinecap="round" strokeLinejoin="round"
          fill="none"
        />
        {/* Leg */}
        <path
          d="M31 36 L44 50"
          stroke="white" strokeWidth="5.5" strokeLinecap="round"
        />
      </svg>
      <span className={cn("truncate text-[15px] font-medium tracking-tight text-foreground", textClassName)}>
        {name}
      </span>
    </div>
  )
}
