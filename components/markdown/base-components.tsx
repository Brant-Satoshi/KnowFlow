import type { Components } from "react-markdown"
import { cn } from "@/lib/utils"

/**
 * Shared react-markdown renderer base for chat answers and file previews.
 * Consumers spread this map and override only what differs — the chat card
 * wraps text nodes with citation injection and swaps `pre` for its CodeBlock;
 * the file preview adds a plain styled `pre`.
 *
 * Links never get citation injection anywhere: InlineCitation renders a
 * <button>, and a button inside an <a> is invalid HTML with broken click
 * semantics, so bracketed text inside link text falls through literally.
 */
export const baseMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 text-lg font-semibold leading-7 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 text-base font-semibold leading-7 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 text-sm font-semibold leading-6 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 text-sm font-medium leading-6 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="leading-7 not-first:mt-4">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-current">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="cursor-pointer font-medium text-primary underline decoration-primary/35 underline-offset-4"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-primary/30 pl-4 italic text-foreground/80">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="border-r border-border px-3 py-2 font-semibold text-foreground last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-r border-border px-3 py-2 align-top leading-6 last:border-r-0">
      {children}
    </td>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ children, className }) => {
    if (className) {
      return <code className={cn("font-code text-[13px]", className)}>{children}</code>
    }
    return (
      <code className="inline-code-token font-code text-[0.92em]">
        {children}
      </code>
    )
  },
}
