"use client"

import { createContext, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { Components } from "react-markdown"
import { Check, Copy } from "lucide-react"
import { useLanguage } from "@/lib/i18n/LanguageContext"
import { MermaidDiagram } from "@/components/mermaid-diagram"
import { cn } from "@/lib/utils"

// While the answer is still streaming a ```mermaid``` block holds incomplete,
// unparseable syntax. CodeBlock reads this to defer diagram rendering until the
// stream finishes, showing the raw code in the meantime.
export const StreamingContext = createContext(false)

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children)
  }
  return ""
}

export const CodeBlock: Components["pre"] = ({ children, className, node, ...rest }) => {
  void node
  const { t } = useLanguage()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const isStreaming = useContext(StreamingContext)
  const rawText = extractText(children)
  let language: string | null = null
  if (isValidElement<{ className?: string }>(children)) {
    const cls = children.props.className ?? ""
    const match = /language-([\w-]+)/.exec(cls)
    language = match ? match[1] : null
  }

  // Render mermaid as a diagram once the stream is complete; while streaming it
  // falls through to the normal code block (the syntax is still incomplete).
  if (language === "mermaid" && !isStreaming) {
    return <MermaidDiagram code={rawText.replace(/\n$/, "")} />
  }

  const handleCopy = async () => {
    if (!rawText) return
    try {
      await navigator.clipboard.writeText(rawText)
      if (timerRef.current) clearTimeout(timerRef.current)
      setCopied(true)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard may be unavailable in insecure contexts; silently no-op.
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-border bg-secondary">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <span className="font-code">{language ?? ""}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? t.messageActions.copied : t.messageActions.copy}</span>
        </button>
      </div>
      <pre className={cn("font-code overflow-x-auto p-4 text-sm/6", className)} {...rest}>
        {children}
      </pre>
    </div>
  )
}
