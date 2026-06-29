import { cn } from "@/lib/utils"

type BrandLogoProps = {
  name: string
  className?: string
  textClassName?: string
  iconSize?: number
  /** Render a single camelCase brand token (e.g. "KnowFlow") as Know + accented Flow. */
  wordmarkAccent?: boolean
}

// Split a clean two-part camelCase token like "KnowFlow" into ["Know", "Flow"].
// Returns null for anything else (e.g. a knowledge-base name) so it renders plain.
function splitWordmark(name: string): [string, string] | null {
  const m = name.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/)
  return m ? [m[1], m[2]] : null
}

export function BrandLogo({
  name,
  className,
  textClassName,
  iconSize = 34,
  wordmarkAccent = false,
}: BrandLogoProps) {
  const parts = wordmarkAccent ? splitWordmark(name) : null

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Open Pages — an open book whose pages curve like a current */}
        <path d="M50,30 C40,23 27,23 18,28 L18,72 C27,67 40,67 50,74 Z" className="fill-primary" />
        <path
          d="M50,30 C60,23 73,23 82,28 L82,72 C73,67 60,67 50,74 Z"
          className="fill-primary"
          opacity={0.72}
        />
      </svg>
      <span className={cn("truncate text-[15px] font-medium tracking-tight text-foreground", textClassName)}>
        {parts ? (
          <>
            {parts[0]}
            <span className="font-bold text-primary">{parts[1]}</span>
          </>
        ) : (
          name
        )}
      </span>
    </div>
  )
}
