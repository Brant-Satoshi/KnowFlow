import type { Chunk, RefusalReason } from '@/lib/types';
import { isConversationSummaryQuery } from '@/lib/validation';

/**
 * The rerank model `RETRIEVAL.minRerankScore` was calibrated against. Relevance
 * scores are not comparable across rerankers — a 0.1 from one is not a 0.1 from
 * another — so the floor is skipped entirely when a different model is configured
 * (`OPENROUTER_RERANK_MODEL`). Failing open risks answering from a weak chunk;
 * failing closed would risk refusing good ones on a threshold that was never
 * measured for that model.
 */
export const CALIBRATED_RERANK_MODEL = 'cohere/rerank-v3.5';

export interface RefusalGateOptions {
  /** `RETRIEVAL.minRerankScore`. <= 0 disables the score floor. */
  minRerankScore: number;
  /** `resolveRerankProvider().model` — the reranker that actually scored these chunks. */
  rerankModel: string;
}

/** Highest rerank score among the chunks that carry one; null when none do. */
export function maxRerankScore(chunks: Chunk[]): number | null {
  let max: number | null = null;
  for (const chunk of chunks) {
    const score = chunk.meta?._rerankScore;
    if (typeof score === 'number' && (max === null || score > max)) {
      max = score;
    }
  }
  return max;
}

/**
 * Decide whether this turn must be refused instead of sent to the LLM.
 *
 * The prompt already tells the model to answer only from the context and to say
 * it found nothing otherwise — but that is a request, not a guarantee, and an
 * empty context is exactly where a model is most tempted to fill the silence
 * from its own weights. This gate makes the refusal a property of the code.
 *
 * Returns null when the turn may proceed to the LLM.
 */
export function assessRetrieval(
  question: string,
  finalChunks: Chunk[],
  opts: RefusalGateOptions,
): RefusalReason | null {
  if (finalChunks.length === 0) {
    // "Recap the conversation" is the one query that legitimately has no context:
    // buildPrompt answers it from history alone. A *topical* summary is not
    // exempt — with nothing retrieved, it gets refused like any other question.
    return isConversationSummaryQuery(question) ? null : 'empty';
  }

  if (opts.minRerankScore <= 0) return null;
  if (opts.rerankModel !== CALIBRATED_RERANK_MODEL) return null;

  const top = maxRerankScore(finalChunks);
  // Nothing carries a score: rerank is disabled, its API degraded to recall
  // order, or it short-circuited on a single chunk. The floor has nothing to
  // stand on, so it stays inert and recall's distance ceiling remains the only
  // relevance guard — same as before this gate existed.
  if (top === null) return null;

  return top < opts.minRerankScore ? 'low_score' : null;
}
