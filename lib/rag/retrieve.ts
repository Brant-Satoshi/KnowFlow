import { searchChunks, keywordSearchChunks } from '@/lib/db/chunks';
import { embedText } from '@/lib/rag/embeddings';
import { rerankChunks } from '@/lib/rag/rerank';
import { reciprocalRankFusion } from '@/lib/rag/fusion';
import { isHybridSearchEnabled } from '@/lib/models';
import type { Chunk, RetrievalFilter } from '@/lib/types';

// Single source of truth for retrieval parameters, shared by chat, eval,
// and the manual search API. Eval must retrieve exactly like production
// chat, or its scores measure a pipeline that never runs.
export const RETRIEVAL = {
  recallTopK: 20,
  maxDistance: 0.6,
  rerankTopN: 8,
  finalTopK: 5,
  // Refusal floor: refuse when the reranker's best score falls below this
  // (lib/rag/refusal-gate.ts). Deliberately 0 — i.e. off. `pnpm eval:refusal`
  // found the reranker scores an unanswerable near-miss ABOVE an answerable
  // question (0.9055 vs 0.8808): relevance is not answerability, so no floor
  // separates them. The best "safe" floor sat 0.0058 from a real answer and
  // then false-refused 11.1% of the held-out set. See ADR-011. Do not raise this
  // without re-running that calibration on the target corpus.
  minRerankScore: 0,
  // pg_trgm word_similarity floor for the keyword leg. The extension default
  // (0.6) is unreachable for CJK queries against continuous prose.
  keywordSimThreshold: 0.05,
  // Hybrid (RRF) fusion. The keyword leg recalls the same width as the vector
  // leg so neither dominates fusion by candidate count alone; rrfK damps how
  // steeply top ranks dominate (60 is the RRF paper's value).
  keywordRecallTopK: 20,
  rrfK: 60,
} as const;

/**
 * Recall strategy:
 * - 'vector': pgvector cosine search only (the original single leg)
 * - 'hybrid': fuse the vector leg with the pg_trgm keyword leg via RRF
 */
export type RecallMode = 'vector' | 'hybrid';

export interface RecallOptions {
  knowledgeBaseId: string;
  filter?: RetrievalFilter;
  signal?: AbortSignal;
  /** Overrides the env-flag default (`HYBRID_SEARCH_ENABLED`). Eval passes it explicitly. */
  mode?: RecallMode;
}

/**
 * Recall stage: embed the question and search the knowledge base.
 *
 * In hybrid mode the keyword leg (a DB query) is kicked off concurrently with
 * the embedding network call, so fusion adds no latency on the critical path.
 * Both legs share the same KB scope and `RetrievalFilter`, so fusion can never
 * mix tenants or bypass a filter. A keyword-leg failure degrades to
 * vector-only recall rather than sinking the request.
 */
export async function recallChunks(question: string, opts: RecallOptions): Promise<Chunk[]> {
  const mode = opts.mode ?? (isHybridSearchEnabled() ? 'hybrid' : 'vector');

  const keywordPromise =
    mode === 'hybrid'
      ? keywordSearchChunks(
          question,
          RETRIEVAL.keywordRecallTopK,
          RETRIEVAL.keywordSimThreshold,
          undefined,
          opts.knowledgeBaseId,
          opts.filter,
        ).catch((err) => {
          console.error('[retrieve] keyword leg failed; using vector-only recall:', err);
          return [] as Chunk[];
        })
      : null;

  const embedding = await embedText(question, { signal: opts.signal });
  const vectorHits = await searchChunks(
    embedding,
    RETRIEVAL.recallTopK,
    RETRIEVAL.maxDistance,
    undefined,
    opts.knowledgeBaseId,
    opts.filter,
  );

  if (!keywordPromise) {
    return vectorHits;
  }

  const keywordHits = await keywordPromise;
  return reciprocalRankFusion([vectorHits, keywordHits], RETRIEVAL.rrfK).slice(
    0,
    RETRIEVAL.recallTopK,
  );
}

/**
 * Rerank behavior per caller:
 * - 'auto': honor RERANK_ENABLED (production chat)
 * - 'force': always rerank (eval's with-rerank branch)
 * - 'off': keep recall order (eval's without-rerank branch)
 */
export type RerankMode = 'auto' | 'force' | 'off';

/** Precision stage: rerank per mode, then cut to the final context window. */
export async function selectFinalChunks(
  question: string,
  recalled: Chunk[],
  mode: RerankMode,
  signal?: AbortSignal,
): Promise<Chunk[]> {
  const ordered =
    mode === 'off'
      ? recalled
      : await rerankChunks(question, recalled, {
          topN: RETRIEVAL.rerankTopN,
          force: mode === 'force',
          signal,
        });
  return ordered.slice(0, RETRIEVAL.finalTopK);
}
