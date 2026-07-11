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
