"use client"

import { useEffect, useId, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTheme } from "next-themes"

// mermaid is a heavy dependency (~hundreds of KB). Load it lazily the first time
// a diagram actually renders so it stays out of the main chat bundle.
type Mermaid = typeof import("mermaid")["default"]
let mermaidPromise: Promise<Mermaid> | null = null
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default)
  }
  return mermaidPromise
}

export function MermaidDiagram({ code }: { code: string }) {
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // useId gives a stable, collision-free id for mermaid's transient render node.
  const renderId = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`

  useEffect(() => {
    let cancelled = false
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          // strict sanitises diagram-embedded HTML — important since the source
          // text comes from LLM output.
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        })
        return mermaid.render(renderId, code)
      })
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg)
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(null)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [code, resolvedTheme, renderId])

  // Invalid syntax (or a load failure): fall back to showing the raw source so
  // the content is never lost. No copy here — the diagram is the point.
  if (failed) {
    return (
      <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-secondary p-4 text-sm">
        <code className="font-code text-[13px]">{code}</code>
      </pre>
    )
  }

  if (!svg) {
    return (
      <div className="mt-4 flex items-center justify-center rounded-xl border border-border bg-secondary p-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div
      className="mt-4 flex justify-center overflow-x-auto rounded-xl border border-border bg-secondary p-4"
      // mermaid output is sanitised via securityLevel: "strict" above.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
