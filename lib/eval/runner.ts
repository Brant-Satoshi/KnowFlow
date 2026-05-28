import type {
  Chunk,
  EvalCase,
  EvalCaseResult,
  EvalChunkHit,
  EvalRunComparison,
  EvalRunResult,
  EvalTopKHit,
} from '@/lib/types';
import { embedText } from '@/lib/rag/embeddings';
import { searchChunks } from '@/lib/db/chunks';
import { rerankChunks } from '@/lib/rag/rerank';
import { buildPrompt, generateAnswer } from '@/lib/llm/chat';
import { gradeRecalled } from './relevance';
import { aggregateMetrics } from './metrics';
import { hashDataset } from './hash';

const TOP_K_VALUES = [1, 3, 5];
const FINAL_TOP_K = 5;
const SEARCH_TOP_K = 20;
const MAX_DISTANCE = 0.6;
const CASE_CONCURRENCY = 3;

export interface RunCuratedEvalOpts {
  knowledgeBaseId: string;
  signal?: AbortSignal;
  // PR 2 hooks (currently no-ops):
  judge?: boolean;
}

/**
 * Run a curated evaluation comparison (with/without rerank) over the given cases.
 *
 * Each case embeds once, searches once, then branches into two rerank
 * configurations sharing the same recalled candidate set — same shape as the
 * legacy route. Cases run with bounded concurrency.
 *
 * No LLM judges in PR 1; faithfulness/answer-relevance are deferred.
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
    );
  } catch (e) {
    recallError = true;
    console.error('[eval/runner] recall error:', e);
  }

  const [withRerankBranch, withoutRerankBranch] = await Promise.all([
    runBranch(c, recalled, recallError, true, opts.signal),
    runBranch(c, recalled, recallError, false, opts.signal),
  ]);

  // PR 2 hook: judge calls would go here, in parallel per branch.
  // const [faithful, relevance] = await Promise.all([judgeFaithfulness(...), judgeAnswerRelevance(...)]);

  const outOfScope = isOutOfScope(c);
  return {
    withRerank: { result: buildCaseResult(c, withRerankBranch, outOfScope), outOfScope },
    withoutRerank: { result: buildCaseResult(c, withoutRerankBranch, outOfScope), outOfScope },
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
): EvalCaseResult {
  const grades = gradeRecalled(branch.finalChunks, c);

  // Curated retrievalHit semantics:
  //   - normal case: at least one retrieved chunk grades >= 2
  //   - out-of-scope: no retrieved chunk grades >= 2 (correct refusal at the retrieval layer)
  const hasRelevant = grades.some(g => g >= 2);
  const retrievalHit = outOfScope ? !hasRelevant : hasRelevant;

  // Citation hit: mirror legacy regex + keyword overlap (will be replaced by LLM judge in PR 2).
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
    mode: 'curated',
    datasetHash,
  };
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
