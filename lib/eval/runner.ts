import type {
  Chunk,
  EvalCase,
  EvalCaseResult,
  EvalChunkHit,
  EvalRunComparison,
  EvalRunResult,
  EvalTopKHit,
  RetrievalFilter,
} from '@/lib/types';
import { embedText } from '@/lib/rag/embeddings';
import { searchChunks } from '@/lib/db/chunks';
import { rerankChunks } from '@/lib/rag/rerank';
import { buildPrompt, generateAnswer } from '@/lib/llm/chat';
import { gradeRecalled } from './relevance';
import { aggregateMetrics } from './metrics';
import { hashDataset } from './hash';
import { judgeFaithfulness, judgeAnswerRelevance } from './judge';

const TOP_K_VALUES = [1, 3, 5];
const FINAL_TOP_K = 5;
const SEARCH_TOP_K = 20;
const MAX_DISTANCE = 0.6;
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
}

interface PerCaseResult {
  withRerank: CaseRunRecord;
  withoutRerank: CaseRunRecord;
}

async function runCase(c: EvalCase, opts: RunCuratedEvalOpts): Promise<PerCaseResult> {
  let recalled: Chunk[] = [];
  let recallError = false;

  try {
    const embedding = await embedText(c.question);
    recalled = await searchChunks(
      embedding,
      SEARCH_TOP_K,
      MAX_DISTANCE,
      undefined,
      opts.knowledgeBaseId,
      opts.filter,
    );
  } catch (e) {
    recallError = true;
    console.error('[eval/runner] recall error:', e);
  }

  const [withRerankBranch, withoutRerankBranch] = await Promise.all([
    runBranch(c, recalled, recallError, true, opts.signal),
    runBranch(c, recalled, recallError, false, opts.signal),
  ]);

  const outOfScope = isOutOfScope(c);

  // Judge only the branch the caller keeps; skip refusals and pipeline errors.
  const useRerankSelected = opts.useRerank !== false;
  const selected = useRerankSelected ? withRerankBranch : withoutRerankBranch;
  let scores: JudgeScores = EMPTY_SCORES;
  if (opts.judge && !selected.pipelineError && !outOfScope) {
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
  signal: AbortSignal | undefined,
): Promise<CaseBranchOutcome> {
  const start = Date.now();
  let finalChunks: Chunk[] = [];
  let answer = '';
  let pipelineError = recallError;

  if (!pipelineError) {
    try {
      const ordered = useRerank
        ? await rerankChunks(c.question, recalled, { topN: 8, force: true, signal })
        : recalled;
      finalChunks = ordered.slice(0, FINAL_TOP_K);
      answer = await generateAnswer(buildPrompt(c.question, finalChunks), { signal });
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
  };
}

function isOutOfScope(c: EvalCase): boolean {
  return (
    (c.targetFileNames?.length ?? 0) === 0 &&
    (c.targetChunkSubstrings?.length ?? 0) === 0
  );
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
    mode: 'curated',
    datasetHash,
  };
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
