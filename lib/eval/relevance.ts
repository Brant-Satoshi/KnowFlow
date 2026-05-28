import type { Chunk, EvalCase } from '@/lib/types';

/**
 * Grade a retrieved chunk against a case's ground truth.
 *
 *   3 = chunk text contains any `targetChunkSubstrings[i]` — strongest signal.
 *       Wins even if the chunk's file is not in `targetFileNames` (the substring is
 *       considered ground truth on its own — useful when a doc is re-chunked or
 *       the same content appears under a renamed file).
 *   2 = chunk file is in `targetFileNames` AND text contains at least one
 *       `expectedKeywords` (keyword match is case-insensitive, substring-style).
 *   1 = chunk file is in `targetFileNames` but no keyword overlap.
 *   0 = neither file nor substring match.
 *
 * Relevance threshold for Recall@K / Precision@K is grade >= 2 (see metrics.ts).
 */
export function gradeChunk(chunk: Chunk, c: EvalCase): 0 | 1 | 2 | 3 {
  const text = chunk.text ?? '';
  const fileName = chunk.fileName ?? '';

  const substrings = c.targetChunkSubstrings ?? [];
  for (const sub of substrings) {
    if (sub && text.includes(sub)) return 3;
  }

  const fileNames = c.targetFileNames ?? [];
  const fileMatches = fileNames.length > 0 && fileNames.includes(fileName);
  if (!fileMatches) return 0;

  const lowered = text.toLowerCase();
  const keywords = c.expectedKeywords ?? [];
  const keywordHit = keywords.some(kw => kw && lowered.includes(kw.toLowerCase()));
  return keywordHit ? 2 : 1;
}

export function gradeRecalled(chunks: Chunk[], c: EvalCase): number[] {
  return chunks.map(ch => gradeChunk(ch, c));
}
