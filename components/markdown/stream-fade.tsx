"use client"

import { Children, type ReactNode } from "react"

// Word-granular segmentation so CJK prose (no whitespace) still fades in small
// units; falls back to whitespace runs where Intl.Segmenter is unavailable.
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null

function splitSegments(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment)
  return text.split(/(\s+)/).filter(Boolean)
}

/**
 * Offset where the still-growing trailing segment of `text` begins; equals
 * `text.length` when the text ends on a boundary (trailing whitespace).
 * useChatStream holds everything past this offset back from the committed
 * message so each word mounts complete: the fade animation plays on mount
 * only, and in-place growth of an already-mounted tail span would pop in
 * without animating.
 */
export function trailingSegmentStart(text: string): number {
  if (text.length === 0) return 0
  if (/\s$/.test(text)) return text.length
  const segments = splitSegments(text)
  return text.length - segments[segments.length - 1].length
}

/**
 * Wraps the string parts of already-rendered prose in per-word spans carrying
 * the `stream-fade` entry animation (see globals.css). While a message streams
 * it re-renders each frame with longer text: React reuses earlier spans
 * positionally, so only newly mounted spans replay the animation — exactly the
 * appended words fade in, claude.ai-style. Element children (inline citations,
 * nested emphasis) pass through untouched; nested overridden components fade
 * their own strings. Callers render plain text again once streaming ends.
 */
export function fadeStreamingText(node: ReactNode, keyPrefix: string): ReactNode {
  if (typeof node === "string") {
    if (node.trim().length === 0) return node
    return splitSegments(node).map((seg, i) =>
      /\S/.test(seg) ? (
        <span key={`${keyPrefix}-${i}`} className="stream-fade">
          {seg}
        </span>
      ) : (
        seg
      ),
    )
  }
  if (Array.isArray(node)) {
    return Children.map(node, (child, i) => fadeStreamingText(child, `${keyPrefix}.${i}`))
  }
  return node
}
