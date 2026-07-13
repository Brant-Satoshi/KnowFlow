import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/pg";
import { evalRuns, evalRunItems, evalDatasets } from "@/lib/db/schema/eval";
import type { EvalRunResult, RetrievalFilter } from "@/lib/types";

export type SaveRunOptions = {
  datasetId?: string | null;
  datasetName?: string | null;
  useRerank: boolean;
  filter?: RetrievalFilter;
};

export type EvalRunRow = typeof evalRuns.$inferSelect;
export type EvalRunItemRow = typeof evalRunItems.$inferSelect;

/**
 * History list for a knowledge base, newest first. Summary rows only (no
 * per-case items). Served by `eval_runs_kb_idx (knowledge_base_id, created_at)`.
 */
export async function listRuns(
  knowledgeBaseId: string,
): Promise<EvalRunRow[]> {
  return db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.knowledgeBaseId, knowledgeBaseId))
    .orderBy(desc(evalRuns.createdAt));
}

/**
 * A single run plus its per-case items (ordered by idx). Returns null when the
 * run id does not exist.
 */
export async function getRunById(
  id: string,
): Promise<(EvalRunRow & { items: EvalRunItemRow[] }) | null> {
  const [run] = await db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.id, id))
    .limit(1);

  if (!run) return null;

  const items = await db
    .select()
    .from(evalRunItems)
    .where(eq(evalRunItems.runId, id))
    .orderBy(evalRunItems.idx);

  return { ...run, items };
}

type ErrorWithCause = { code?: unknown; constraint?: unknown; cause?: unknown };

/**
 * FK violation (23503) attributable to eval_runs.dataset_id. Some driver
 * wrappers drop `constraint`; that shape is accepted because the retry is
 * bounded to one attempt — if the real violation was the KB FK, the retry
 * fails identically and the error propagates.
 */
function isDatasetFkViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const candidate = current as ErrorWithCause;
    if (
      candidate.code === "23503" &&
      (candidate.constraint === undefined ||
        (typeof candidate.constraint === "string" &&
          candidate.constraint.includes("dataset_id")))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Persist a run. `dataset_name`/`dataset_hash` always come from the caller's
 * execution snapshot; if the dataset was deleted while the run executed, the
 * run is still saved with `dataset_id = NULL` (an orphan that stays hash-
 * comparable). Persistence failures propagate — callers must surface them,
 * never report success.
 */
export async function saveRun(
  result: EvalRunResult,
  opts: SaveRunOptions,
): Promise<void> {
  try {
    await insertRun(result, opts, opts.datasetId ?? null);
  } catch (e) {
    // Dataset deleted between the in-transaction existence check and commit.
    if (opts.datasetId && isDatasetFkViolation(e)) {
      await insertRun(result, opts, null);
      return;
    }
    throw e;
  }
}

async function insertRun(
  result: EvalRunResult,
  opts: SaveRunOptions,
  datasetIdInput: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    let datasetId = datasetIdInput;
    if (datasetId) {
      const [ds] = await tx
        .select({ id: evalDatasets.id })
        .from(evalDatasets)
        .where(eq(evalDatasets.id, datasetId))
        .limit(1);
      if (!ds) datasetId = null;
    }

    await tx.insert(evalRuns).values({
      id: result.runId,
      knowledgeBaseId: result.knowledgeBaseId,
      datasetId,
      datasetName: opts.datasetName ?? null,
      datasetHash: result.datasetHash ?? null,
      mode: result.mode ?? "curated",
      useRerank: opts.useRerank,
      totalCases: result.totalCases,
      passedCases: result.passedCases,
      retrievalHitRate: result.retrievalHitRate,
      citationHitRate: result.citationHitRate,
      avgLatencyMs: result.avgLatencyMs,
      recallAtK: result.recallAtK ?? null,
      precisionAtK: result.precisionAtK ?? null,
      ndcgAtK: result.ndcgAtK ?? null,
      mrr: result.mrr ?? null,
      avgFaithfulness: result.avgFaithfulness ?? null,
      avgAnswerRelevance: result.avgAnswerRelevance ?? null,
      filter: opts.filter ?? null,
    });

    if (result.cases.length === 0) {
      return;
    }

    await tx.insert(evalRunItems).values(
      result.cases.map((item, index) => ({
        runId: result.runId,
        idx: index,
        caseKey: item.caseId,
        question: item.question,
        passed: item.passed,
        failureReasons: item.failureReasons ?? [],
        retrievalHit: item.retrievalHit,
        citationHit: item.citationHit,
        latencyMs: item.latencyMs,
        retrievedChunks: item.retrievedChunks ?? [],
        topKHits: item.topKHits ?? [],
        answer: item.answer ?? "",
        expectedAnswer: item.expectedAnswer ?? null,
        gradedHits: item.gradedHits ?? null,
        faithfulness: item.faithfulness ?? null,
        answerRelevance: item.answerRelevance ?? null,
      })),
    );
  });
}
