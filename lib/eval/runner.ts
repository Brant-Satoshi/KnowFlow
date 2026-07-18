import type {
  Chunk,
  EvalCase,
  EvalCaseResult,
  EvalChunkHit,
  EvalRunComparison,
  EvalRunResult,
  EvalTopKHit,
  RefusalReason,
  RetrievalFilter,
} from '@/lib/types';
import { recallChunks, RETRIEVAL, selectFinalChunks, type RecallMode } from '@/lib/rag/retrieve';
import { assessRetrieval, maxRerankScore } from '@/lib/rag/refusal-gate';
import { resolveRerankProvider } from '@/lib/models';
import { refusalTextFor } from '@/lib/llm/refusal';
import { buildPrompt, generateAnswer } from '@/lib/llm/chat';
import { isOutOfScope } from './dataset';
import { gradeRecalled } from './relevance';
import { aggregateMetrics } from './metrics';
import { hashDataset } from './hash';
import { judgeFaithfulness, judgeAnswerRelevance } from './judge';

const TOP_K_VALUES = [1, 3, 5];
const CASE_CONCURRENCY = 3;

export interface RunCuratedEvalOpts {
  knowledgeBaseId: string;
  signal?: AbortSignal;
  /** Run LLM-judge faithfulness/answer-relevance on the selected branch. */
  judge?: boolean;
  /**
   * Which rerank branch is the "selected" one the caller will keep. Judges run
   * only on that branch to avoid wasting LLM calls on the discarded one.
   * Defaults to the rerank-on branch.
   */
  useRerank?: boolean;
  /** Per-run retrieval filter; both rerank branches share the filtered recall set. */
  filter?: RetrievalFilter;
  /**
   * Recall strategy for both rerank branches. Omitted → `recallChunks` uses its
   * env-flag default (`HYBRID_SEARCH_ENABLED`). Set explicitly to pin a mode for
   * a vector-vs-hybrid comparison regardless of the env flag.
   */
  retrievalMode?: RecallMode;
  /**
   * Whether the refusal gate runs (production default: on). Set false to measure
   * the pipeline as it behaved before the gate existed — that gate-off/gate-on
   * pair is the before/after for a refusal change, run on one dataset.
   */
  refusalGate?: boolean;
}

interface JudgeScores {
  faithfulness: number | null;
  answerRelevance: number | null;
}

const EMPTY_SCORES: JudgeScores = { faithfulness: null, answerRelevance: null };

/**
 * Run a curated evaluation comparison (with/without rerank) over the given cases.
 *
 * Each case embeds once, searches once, then branches into two rerank
 * configurations sharing the same recalled candidate set. Cases run with
 * bounded concurrency.
 *
 * When `opts.judge` is set, LLM faithfulness/answer-relevance is graded on the
 * selected branch (`opts.useRerank`) only.
 */
export async function runComparison(
  cases: EvalCase[],
  opts: RunCuratedEvalOpts,
): Promise<EvalRunComparison> {
  const datasetHash = hashDataset(cases);

  const perCase = await mapLimit(cases, CASE_CONCURRENCY, async (c) => {
    return runCase(c, opts);
  });

  return {
    knowledgeBaseId: opts.knowledgeBaseId,
    withRerank: aggregate(
      opts.knowledgeBaseId,
      perCase.map(r => r.withRerank),
      datasetHash,
    ),
    withoutRerank: aggregate(
      opts.knowledgeBaseId,
      perCase.map(r => r.withoutRerank),
      datasetHash,
    ),
  };
}

interface CaseRunRecord {
  result: EvalCaseResult;
  outOfScope: boolean;
}

interface CaseBranchOutcome {
  finalChunks: Chunk[];
  answer: string;
  latencyMs: number;
  pipelineError: boolean;
  refusalReason: RefusalReason | null;
  maxRerankScore: number | null;
}

interface PerCaseResult {
  withRerank: CaseRunRecord;
  withoutRerank: CaseRunRecord;
}

async function runCase(c: EvalCase, opts: RunCuratedEvalOpts): Promise<PerCaseResult> {
  let recalled: Chunk[] = [];
  let recallError = false;

  try {
    recalled = await recallChunks(c.question, {
      knowledgeBaseId: opts.knowledgeBaseId,
      filter: opts.filter,
      signal: opts.signal,
      mode: opts.retrievalMode,
    });
  } catch (e) {
    recallError = true;
    console.error('[eval/runner] recall error:', e);
  }

  const [withRerankBranch, withoutRerankBranch] = await Promise.all([
    runBranch(c, recalled, recallError, true, opts),
    runBranch(c, recalled, recallError, false, opts),
  ]);

  const outOfScope = isOutOfScope(c);

  // Judge only the branch the caller keeps; skip refusals and pipeline errors.
  // Judging a refusal would score the canned text's faithfulness to chunks it
  // deliberately declined to use.
  const useRerankSelected = opts.useRerank !== false;
  const selected = useRerankSelected ? withRerankBranch : withoutRerankBranch;
  let scores: JudgeScores = EMPTY_SCORES;
  if (opts.judge && !selected.pipelineError && !outOfScope && !selected.refusalReason) {
    const [faithfulness, answerRelevance] = await Promise.all([
      judgeFaithfulness(selected.answer, selected.finalChunks, opts.signal),
      judgeAnswerRelevance(c.question, selected.answer, opts.signal),
    ]);
    scores = { faithfulness, answerRelevance };
  }

  return {
    withRerank: {
      result: buildCaseResult(c, withRerankBranch, outOfScope, useRerankSelected ? scores : EMPTY_SCORES),
      outOfScope,
    },
    withoutRerank: {
      result: buildCaseResult(c, withoutRerankBranch, outOfScope, useRerankSelected ? EMPTY_SCORES : scores),
      outOfScope,
    },
  };
}

async function runBranch(
  c: EvalCase,
  recalled: Chunk[],
  recallError: boolean,
  useRerank: boolean,
  opts: RunCuratedEvalOpts,
): Promise<CaseBranchOutcome> {
  const signal = opts.signal;
  const start = Date.now();
  let finalChunks: Chunk[] = [];
  let answer = '';
  let pipelineError = recallError;
  let refusalReason: RefusalReason | null = null;

  if (!pipelineError) {
    try {
      finalChunks = await selectFinalChunks(
        c.question,
        recalled,
        useRerank ? 'force' : 'off',
        signal,
      );

      // Same gate as production chat. Without it, eval would measure a pipeline
      // that no longer exists — and would credit the LLM for refusals the server
      // now makes on its own.
      refusalReason =
        opts.refusalGate === false
          ? null
          : assessRetrieval(c.question, finalChunks, {
              minRerankScore: RETRIEVAL.minRerankScore,
              rerankModel: resolveRerankProvider().model,
            });

      answer = refusalReason
        ? refusalTextFor(c.question)
        : await generateAnswer(buildPrompt(c.question, finalChunks), { signal });
    } catch (e) {
      pipelineError = true;
      console.error('[eval/runner] branch error:', e);
    }
  }

  return {
    finalChunks,
    answer,
    latencyMs: Date.now() - start,
    pipelineError,
    refusalReason,
    maxRerankScore: maxRerankScore(finalChunks),
  };
}

function buildCaseResult(
  c: EvalCase,
  branch: CaseBranchOutcome,
  outOfScope: boolean,
  scores: JudgeScores,
): EvalCaseResult {
  const grades = gradeRecalled(branch.finalChunks, c);

  // Curated retrievalHit semantics:
  //   - normal case: at least one retrieved chunk grades >= 2
  //   - out-of-scope: no retrieved chunk grades >= 2 (correct refusal at the retrieval layer)
  const hasRelevant = grades.some(g => g >= 2);
  const retrievalHit = outOfScope ? !hasRelevant : hasRelevant;

  // Citation hit: regex + keyword overlap (will be replaced by LLM judge in PR 2).
  const hasCitation = /\[\d+\]/.test(branch.answer);
  const lowered = branch.answer.toLowerCase();
  const hasKeyword =
    c.expectedKeywords.length === 0
      ? true
      : c.expectedKeywords.some(kw => lowered.includes(kw.toLowerCase()));
  const citationHit = outOfScope ? !hasCitation : hasCitation && hasKeyword;

  const topKHits: EvalTopKHit[] = TOP_K_VALUES.map(k => {
    const slice = grades.slice(0, k);
    const hasRelevantInK = slice.some(g => g >= 2);
    return { k, hit: outOfScope ? !hasRelevantInK : hasRelevantInK };
  });

  const failureReasons: string[] = [];
  if (branch.pipelineError) {
    failureReasons.push('pipeline_error');
  } else {
    if (!retrievalHit) failureReasons.push('retrieval_miss');
    if (!citationHit) failureReasons.push('citation_miss');
  }

  const retrievedChunks: EvalChunkHit[] = branch.finalChunks.map(ch => ({
    chunkId: ch.id,
    fileId: ch.fileId,
    fileName: ch.fileName ?? ch.fileId,
    textPreview: ch.text.slice(0, 150),
  }));

  return {
    caseId: c.id,
    question: c.question,
    passed: !branch.pipelineError && retrievalHit && citationHit,
    failureReasons,
    retrievalHit,
    citationHit,
    latencyMs: branch.latencyMs,
    retrievedChunks,
    topKHits,
    answer: branch.answer,
    expectedAnswer: c.expectedAnswer,
    gradedHits: grades,
    faithfulness: scores.faithfulness,
    answerRelevance: scores.answerRelevance,
    refused: branch.refusalReason !== null,
    refusalReason: branch.refusalReason,
    maxRerankScore: branch.maxRerankScore,
  };
}

function aggregate(
  knowledgeBaseId: string,
  records: CaseRunRecord[],
  datasetHash: string,
): EvalRunResult {
  const caseResults = records.map(r => r.result);
  const total = caseResults.length;
  const passed = caseResults.filter(c => c.passed).length;

  const metricsInputs = records.map(r => ({
    grades: r.result.gradedHits ?? [],
    outOfScope: r.outOfScope,
  }));

  const m = aggregateMetrics(metricsInputs, TOP_K_VALUES);

  // Refusal correctness needs its own numbers. The retrieval metrics cannot
  // carry it: an out-of-scope case has no ground-truth chunks, so `retrievalHit`
  // (= "retrieved nothing relevant") is true whether the system refused or
  // invented an answer, and `citationHit` (= "cited nothing") passes an
  // uncited hallucination just as happily as a refusal.
  const oos = records.filter(r => r.outOfScope);
  const inScope = records.filter(r => !r.outOfScope);

  return {
    runId: crypto.randomUUID(),
    knowledgeBaseId,
    totalCases: total,
    passedCases: passed,
    retrievalHitRate: total > 0
      ? caseResults.filter(c => c.retrievalHit).length / total
      : 0,
    citationHitRate: total > 0
      ? caseResults.filter(c => c.citationHit).length / total
      : 0,
    avgLatencyMs: total > 0
      ? Math.round(caseResults.reduce((s, c) => s + c.latencyMs, 0) / total)
      : 0,
    cases: caseResults,
    recallAtK: m.recallAtK,
    precisionAtK: m.precisionAtK,
    ndcgAtK: m.ndcgAtK,
    mrr: m.mrr,
    avgFaithfulness: meanNullable(caseResults.map(c => c.faithfulness ?? null)),
    avgAnswerRelevance: meanNullable(caseResults.map(c => c.answerRelevance ?? null)),
    oosRefusalRate: rate(oos, r => r.result.refused === true),
    inScopeFalseRefusalRate: rate(inScope, r => r.result.refused === true),
    mode: 'curated',
    datasetHash,
  };
}

/** Share of `records` matching `predicate`; null over an empty set. */
function rate(records: CaseRunRecord[], predicate: (r: CaseRunRecord) => boolean): number | null {
  if (records.length === 0) return null;
  return records.filter(predicate).length / records.length;
}

/** Mean over the non-null values; null when there are none (e.g. judging off). */
function meanNullable(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Run `task` over `items` with at most `limit` in flight. Preserves input order
 * in the output array. Inline implementation — no dependency.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await task(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
