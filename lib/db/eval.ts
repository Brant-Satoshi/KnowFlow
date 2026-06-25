import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/pg";
import { evalRuns, evalRunItems } from "@/lib/db/schema/eval";
import { evalCases, evalDatasets } from "@/lib/db/schema/eval";
import type { EvalCase, EvalRunResult } from "@/lib/types";
import { hashDataset } from "../eval/hash";

export type SaveRunOptions = {
  datasetId?: string | null;
  datasetName?: string | null;
  useRerank: boolean;
};

export async function ensureDataset(
  name: string,
  description: string | undefined,
  cases: EvalCase[],
): Promise<string> {
  const datasetHash = hashDataset(cases);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: evalDatasets.id,
        datasetHash: evalDatasets.datasetHash,
      })
      .from(evalDatasets)
      .where(eq(evalDatasets.name, name))
      .limit(1);

    if (!existing) {
      const [created] = await tx
        .insert(evalDatasets)
        .values({
          name,
          description,
          datasetHash,
          caseCount: cases.length,
        })
        .returning({
          id: evalDatasets.id,
        });

      if (!created) {
        throw new Error("Failed to create eval dataset");
      }

      await insertEvalCases(tx, created.id, cases);

      return created.id;
    }

    if (existing.datasetHash !== datasetHash) {
      await tx
        .update(evalDatasets)
        .set({
          description,
          datasetHash,
          caseCount: cases.length,
          updatedAt: new Date(),
        })
        .where(eq(evalDatasets.id, existing.id));

      await tx
        .delete(evalCases)
        .where(eq(evalCases.datasetId, existing.id));

      await insertEvalCases(tx, existing.id, cases);
    }

    return existing.id;
  });
}

async function insertEvalCases(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  datasetId: string,
  cases: EvalCase[],
): Promise<void> {
  if (cases.length === 0) return;

  await tx.insert(evalCases).values(
    cases.map((item, index) => ({
      datasetId,
      caseKey: item.id,
      question: item.question,

      expectedKeywords: item.expectedKeywords ?? [],
      category: item.category,
      difficulty: item.difficulty,

      targetFileNames: item.targetFileNames ?? [],
      targetChunkSubstrings: item.targetChunkSubstrings ?? [],

      expectedAnswer: item.expectedAnswer ?? null,
      notes: item.notes ?? null,

      idx: index,
    })),
  );
}

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

export async function saveRun(
  result: EvalRunResult,
  opts: SaveRunOptions,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(evalRuns).values({
      id: result.runId,
      knowledgeBaseId: result.knowledgeBaseId,
      datasetId: opts.datasetId ?? null,
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
