import type { Chunk } from '@/lib/types';

/**
 * Reciprocal Rank Fusion of several ranked chunk lists into one ranking.
 *
 * RRF fuses on rank position alone, so the vector leg's cosine distances and
 * the keyword leg's trigram similarities never have to be normalized onto a
 * shared scale — the reason it is the default hybrid fusion for this project
 * (no per-corpus score-weight tuning to maintain).
 *
 * A chunk at 0-based rank `r` in a list contributes `1 / (k + r + 1)`. A
 * chunk's fused score is the sum of its contributions across every list it
 * appears in, so a chunk both legs surface outranks one only a single leg
 * found. `k` (default 60, from the original RRF paper) damps how steeply the
 * top ranks dominate: larger `k` flattens the curve.
 *
 * Chunks are de-duplicated by id. When the same chunk comes from more than one
 * leg, their `meta` is merged so the survivor keeps both signals (e.g.
 * `_distance` from the vector leg and `_keywordSim` from the keyword leg). The
 * fused score is written to `meta._rrfScore` and the result is sorted by it
 * descending (ties broken by id for a stable order).
 */
export function reciprocalRankFusion(lists: Chunk[][], k = 60): Chunk[] {
  const scores = new Map<string, number>();
  const merged = new Map<string, Chunk>();

  for (const list of lists) {
    list.forEach((chunk, rank) => {
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + rank + 1));
      const existing = merged.get(chunk.id);
      if (existing) {
        // Keep both legs' derived signals; the already-stored copy wins on any
        // shared key so a chunk's identity fields stay from its first sighting.
        existing.meta = { ...chunk.meta, ...existing.meta };
      } else {
        merged.set(chunk.id, { ...chunk, meta: { ...chunk.meta } });
      }
    });
  }

  return Array.from(merged.values())
    .map(chunk => ({
      ...chunk,
      meta: { ...chunk.meta, _rrfScore: scores.get(chunk.id) },
    }))
    .sort((a, b) => {
      const diff = (b.meta._rrfScore ?? 0) - (a.meta._rrfScore ?? 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
}
