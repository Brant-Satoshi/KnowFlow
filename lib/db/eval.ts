import { db } from "@/lib/db/pg";
import { evalRuns, evalRunItems } from "@/lib/db/schema/eval";
import type { EvalRunResult } from "@/lib/types";
// import { hashDataset } from "../eval/hash";

export type SaveRunOptions = {
  datasetId?: string | null;
  datasetName?: string | null;
  useRerank: boolean;
};

// export async function ensureDataset(
//   name: string,
//   description: string | undefined,
//   cases: EvalCase[],
// ): Promise<string> {
//    const datasetHash = hashDataset(cases);
// }

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
      })),
    );
  });
}
