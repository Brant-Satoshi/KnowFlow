import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { isValidUuid } from '@/lib/validation';
import { sampleKbChunks, searchChunks } from '@/lib/db/chunks';
import { embedText } from '@/lib/rag/embeddings';
import { rerankChunks } from '@/lib/rag/rerank';
import { buildPrompt, generateAnswer } from '@/lib/llm/chat';
import type { Chunk, EvalCaseResult, EvalRunResult } from '@/lib/types';
import { loadDataset } from '@/lib/eval/dataset';
import { runComparison } from '@/lib/eval/runner';

const EVAL_CASE_COUNT = 5;
const TOP_K_VALUES = [1, 3, 5];
const QUESTION_TEMPLATE = 'What does the knowledge base say about: {seed}?';

function makeQuestion(text: string): string {
  const seed = text.split(/[.!?\n]/)[0].trim().slice(0, 120);
  return QUESTION_TEMPLATE.replace('{seed}', seed);
}

function extractKeywords(text: string): string[] {
  return [...new Set(text.split(/\W+/).filter(w => w.length > 5))]
    .slice(0, 6)
    .map(w => w.toLowerCase());
}

type CaseBranch = {
  finalChunks: Chunk[];
  answer: string;
  latencyMs: number;
  pipelineError: boolean;
};

function buildCaseResult(
  seed: Chunk,
  question: string,
  expectedKeywords: string[],
  recalled: Chunk[],
  branch: CaseBranch,
): EvalCaseResult {
  const finalHitIdx = branch.finalChunks.findIndex(c => c.id === seed.id);
  const retrievalHit = finalHitIdx >= 0;

  const hasCitation = /\[\d+\]/.test(branch.answer);
  const hasKeyword = expectedKeywords.some(kw => branch.answer.toLowerCase().includes(kw));
  const citationHit = hasCitation && hasKeyword;

  const recallHitIdx = recalled.findIndex(c => c.id === seed.id);
  const topKHits = TOP_K_VALUES.map(k => ({
    k,
    hit: recallHitIdx >= 0 && recallHitIdx < k,
  }));

  const failureReasons: string[] = [];
  if (branch.pipelineError) {
    failureReasons.push('pipeline_error');
  } else {
    if (!retrievalHit) failureReasons.push('retrieval_miss');
    if (!citationHit) failureReasons.push('citation_miss');
  }

  return {
    caseId: seed.id,
    question,
    passed: !branch.pipelineError && retrievalHit && citationHit,
    failureReasons,
    retrievalHit,
    citationHit,
    latencyMs: branch.latencyMs,
    retrievedChunks: branch.finalChunks.map(c => ({
      chunkId: c.id,
      fileId: c.fileId,
      fileName: c.fileName ?? c.fileId,
      textPreview: c.text.slice(0, 150),
    })),
    topKHits,
    answer: branch.answer,
  };
}

function aggregate(
  knowledgeBaseId: string,
  caseResults: EvalCaseResult[],
): EvalRunResult {
  const total = caseResults.length;
  return {
    runId: crypto.randomUUID(),
    knowledgeBaseId,
    totalCases: total,
    passedCases: caseResults.filter(c => c.passed).length,
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
  };
}

async function runBranch(args: {
  question: string;
  recalled: Chunk[];
  recallError: boolean;
  useRerank: boolean;
}): Promise<CaseBranch> {
  const start = Date.now();
  let finalChunks: Chunk[] = [];
  let answer = '';
  let pipelineError = args.recallError;

  if (!pipelineError) {
    try {
      const ordered = args.useRerank
        ? await rerankChunks(args.question, args.recalled, { topN: 8, force: true })
        : args.recalled;
      finalChunks = ordered.slice(0, 5);
      answer = await generateAnswer(buildPrompt(args.question, finalChunks));
    } catch (e) {
      pipelineError = true;
      console.error('[eval/run] branch error:', e);
    }
  }

  return {
    finalChunks,
    answer,
    latencyMs: Date.now() - start,
    pipelineError,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const b = body as Record<string, unknown>;

  const knowledgeBaseId = b['knowledgeBaseId'];
  if (!knowledgeBaseId || typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
    return Response.json(error('invalid_request'), { status: 400 });
  }

  const rawMode = b['mode'];
  const mode: 'legacy' | 'curated' = rawMode === 'curated' ? 'curated' : 'legacy';
  const useRerank = b['useRerank'] !== false;

  if (mode === 'curated') {
    const datasetName = b['datasetName'];
    if (!datasetName || typeof datasetName !== 'string') {
      return Response.json(error('invalid_request'), { status: 400 });
    }
    let cases;
    try {
      cases = loadDataset(datasetName);
    } catch {
      return Response.json(error('unknown_dataset'), { status: 400 });
    }
    try {
      const comparison = await runComparison(cases, { knowledgeBaseId });
      return Response.json(success(useRerank ? comparison.withRerank : comparison.withoutRerank));
    } catch (e) {
      console.error('[eval/run] curated error:', e);
      return Response.json(error('eval_failed'), { status: 500 });
    }
  }

  try {
    const seedChunks = await sampleKbChunks(knowledgeBaseId, EVAL_CASE_COUNT);

    if (seedChunks.length === 0) {
      return Response.json(error('eval_no_chunks'), { status: 422 });
    }

    const caseResults: EvalCaseResult[] = [];

    for (const seed of seedChunks) {
      const question = makeQuestion(seed.text);
      const expectedKeywords = extractKeywords(seed.text);

      let recalled: Chunk[] = [];
      let recallError = false;

      try {
        const embedding = await embedText(question);
        recalled = await searchChunks(embedding, 20, 0.4, undefined, knowledgeBaseId);
      } catch (e) {
        recallError = true;
        console.error('[eval/run] recall error:', e);
      }

      const branch = await runBranch({
        question,
        recalled,
        recallError,
        useRerank,
      });

      caseResults.push(
        buildCaseResult(seed, question, expectedKeywords, recalled, branch),
      );
    }

    return Response.json(success(aggregate(knowledgeBaseId, caseResults)));
  } catch (e) {
    console.error('[eval/run] error:', e);
    return Response.json(error('eval_failed'), { status: 500 });
  }
}
