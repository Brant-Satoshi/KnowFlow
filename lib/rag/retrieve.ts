import { searchChunks } from '@/lib/db/chunks';
import { embedText } from '@/lib/rag/embeddings';
import { rerankChunks } from '@/lib/rag/rerank';
import type { Chunk, RetrievalFilter } from '@/lib/types';

// Single source of truth for the chat/eval retrieval pipeline. Eval must
// retrieve exactly like production chat, or its scores measure a pipeline
// that never runs.
const RECALL_TOP_K = 20;
const RECALL_MAX_DISTANCE = 0.6;
const RERANK_TOP_N = 8;
const FINAL_TOP_K = 5;

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
    RECALL_TOP_K,
    RECALL_MAX_DISTANCE,
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
          topN: RERANK_TOP_N,
          force: mode === 'force',
          signal,
        });
  return ordered.slice(0, FINAL_TOP_K);
}
