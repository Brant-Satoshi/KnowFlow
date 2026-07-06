import { searchChunks } from '@/lib/db/chunks';
import { embedText } from '@/lib/rag/embeddings';
import { rerankChunks } from '@/lib/rag/rerank';
import type { Chunk, RetrievalFilter } from '@/lib/types';

// Single source of truth for retrieval parameters, shared by chat, eval,
// and the manual search API. Eval must retrieve exactly like production
// chat, or its scores measure a pipeline that never runs.
export const RETRIEVAL = {
  recallTopK: 20,
  maxDistance: 0.6,
  rerankTopN: 8,
  finalTopK: 5,
  // pg_trgm word_similarity floor for the keyword leg. The extension default
  // (0.6) is unreachable for CJK queries against continuous prose.
  keywordSimThreshold: 0.05,
} as const;

export interface RecallOptions {
  knowledgeBaseId: string;
  filter?: RetrievalFilter;
  signal?: AbortSignal;
}

/** Recall stage: embed the question and vector-search the knowledge base. */
export async function recallChunks(question: string, opts: RecallOptions): Promise<Chunk[]> {
  const embedding = await embedText(question, { signal: opts.signal });
  return searchChunks(
    embedding,
    RETRIEVAL.recallTopK,
    RETRIEVAL.maxDistance,
    undefined,
    opts.knowledgeBaseId,
    opts.filter,
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
