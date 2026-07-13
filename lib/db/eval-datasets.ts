import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/pg";
import { evalCases, evalDatasets } from "@/lib/db/schema/eval";
import { hashDataset } from "@/lib/eval/hash";
import { evalCaseFromColumns, evalCaseToColumns } from "@/lib/eval/goldset";
import { MAX_GOLDSET_CASES } from "@/lib/validation";
import type {
  EvalCase,
  EvalCaseRecord,
  EvalDatasetDetail,
  EvalDatasetSummary,
} from "@/lib/types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatasetRow = typeof evalDatasets.$inferSelect;
type CaseRow = typeof evalCases.$inferSelect;

/**
 * One consistent read of a dataset: the row's hash plus the cases that hash
 * was computed over. The run route asserts `hashDataset(cases) ===
 * datasetHash` on this object, so both selects run inside a REPEATABLE READ
 * transaction — a write committing between them cannot produce a torn
 * snapshot.
 */
export interface EvalDatasetSnapshot {
  id: string;
  name: string;
  description: string | null;
  datasetHash: string;
  /** Ordered by idx — exactly what dataset_hash was computed over. */
  cases: EvalCase[];
}

/** Everything a write can report; routes map kinds onto HTTP statuses. */
export type EvalDatasetWriteResult =
  | { kind: "ok"; dataset: EvalDatasetSummary; cases: EvalCaseRecord[] }
  | { kind: "not_found" }
  | { kind: "dataset_changed"; currentRevision: number; currentHash: string }
  | { kind: "duplicate_name" }
  | { kind: "case_not_found" }
  | {
      kind: "case_key_conflict";
      duplicateCaseKeys: string[];
      limit: number;
      existingCount: number;
      incomingCount: number;
    }
  | {
      kind: "limit_exceeded";
      duplicateCaseKeys: string[];
      limit: number;
      existingCount: number;
      incomingCount: number;
    };

function toSummary(row: DatasetRow): EvalDatasetSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    datasetHash: row.datasetHash,
    revision: row.revision,
    caseCount: row.caseCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCaseRecord(row: CaseRow): EvalCaseRecord {
  const c = evalCaseFromColumns(row);
  return {
    id: row.id,
    caseKey: row.caseKey,
    question: row.question,
    expectedKeywords: c.expectedKeywords,
    category: c.category,
    difficulty: c.difficulty,
    targetFileNames: c.targetFileNames ?? [],
    targetChunkSubstrings: c.targetChunkSubstrings ?? [],
    expectedAnswer: row.expectedAnswer,
    notes: row.notes,
    idx: row.idx,
  };
}

/** Case rows in hash order. idx is unique per dataset by construction; id breaks ties deterministically. */
async function readCaseRows(tx: Tx, datasetId: string): Promise<CaseRow[]> {
  return tx
    .select()
    .from(evalCases)
    .where(eq(evalCases.datasetId, datasetId))
    .orderBy(asc(evalCases.idx), asc(evalCases.id));
}

/** `SELECT … FOR UPDATE` on the dataset row — serializes all writers of one dataset. */
async function lockDataset(tx: Tx, datasetId: string): Promise<DatasetRow | undefined> {
  const [row] = await tx
    .select()
    .from(evalDatasets)
    .where(eq(evalDatasets.id, datasetId))
    .limit(1)
    .for("update");
  return row;
}

type LockGate =
  | { ok: true; row: DatasetRow }
  | {
      ok: false;
      failure:
        | { kind: "not_found" }
        | { kind: "dataset_changed"; currentRevision: number; currentHash: string };
    };

/**
 * Lock the dataset row and verify the caller's optimistic-concurrency token.
 * `revision` bumps on every write — metadata included — so a rename by one
 * client makes another client's stale edit/delete fail with 409 instead of
 * silently overwriting (dataset_hash only covers case content and stays a
 * pure comparability identity).
 */
async function lockDatasetAt(
  tx: Tx,
  datasetId: string,
  expectedRevision: number,
): Promise<LockGate> {
  const row = await lockDataset(tx, datasetId);
  if (!row) return { ok: false, failure: { kind: "not_found" } };
  if (row.revision !== expectedRevision) {
    return {
      ok: false,
      failure: {
        kind: "dataset_changed",
        currentRevision: row.revision,
        currentHash: row.datasetHash,
      },
    };
  }
  return { ok: true, row };
}

async function insertCases(
  tx: Tx,
  datasetId: string,
  cases: EvalCase[],
  startIdx: number,
): Promise<void> {
  if (cases.length === 0) return;
  await tx.insert(evalCases).values(
    cases.map((c, i) => ({
      datasetId,
      ...evalCaseToColumns(c),
      idx: startIdx + i,
    })),
  );
}

/**
 * Tail of every successful write: re-read all cases in idx order, recompute
 * dataset_hash and case_count from what is actually stored, bump the
 * revision, write everything back, and return the fresh summary + records
 * (the new revision feeds the UI's next `expectedRevision`).
 */
async function finalizeDataset(
  tx: Tx,
  datasetId: string,
): Promise<Extract<EvalDatasetWriteResult, { kind: "ok" }>> {
  const rows = await readCaseRows(tx, datasetId);
  const nextHash = hashDataset(rows.map(evalCaseFromColumns));
  const [updated] = await tx
    .update(evalDatasets)
    .set({
      datasetHash: nextHash,
      caseCount: rows.length,
      revision: sql`${evalDatasets.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(evalDatasets.id, datasetId))
    .returning();
  if (!updated) {
    throw new Error("eval dataset disappeared inside its own write transaction");
  }
  return { kind: "ok", dataset: toSummary(updated), cases: rows.map(toCaseRecord) };
}

type ErrorWithCause = { code?: unknown; constraint?: unknown; cause?: unknown };

/**
 * Drizzle may wrap the node-postgres error in `cause`; some wrappers keep
 * `code` but drop `constraint` (same caveat as lib/auth/users.ts). A missing
 * constraint name is accepted because in-batch/case-key duplicates are
 * pre-checked under the row lock, so a 23505 here can only be the name index.
 */
function isUniqueNameViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const candidate = current as ErrorWithCause;
    if (
      candidate.code === "23505" &&
      (candidate.constraint === undefined ||
        candidate.constraint === "eval_datasets_name_unique")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** case_keys that appear more than once within one submission. */
function duplicateKeysWithin(cases: EvalCase[]): string[] {
  const counts = new Map<string, number>();
  for (const c of cases) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

export async function listEvalDatasets(): Promise<EvalDatasetSummary[]> {
  const rows = await db.select().from(evalDatasets).orderBy(asc(evalDatasets.name));
  return rows.map(toSummary);
}

/** Used by the seed to create built-ins only when absent. */
export async function findEvalDatasetByName(
  name: string,
): Promise<EvalDatasetSummary | null> {
  const [row] = await db
    .select()
    .from(evalDatasets)
    .where(eq(evalDatasets.name, name))
    .limit(1);
  return row ? toSummary(row) : null;
}

export async function getEvalDatasetDetail(
  id: string,
): Promise<EvalDatasetDetail | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select()
        .from(evalDatasets)
        .where(eq(evalDatasets.id, id))
        .limit(1);
      if (!row) return null;
      const caseRows = await readCaseRows(tx, id);
      return { ...toSummary(row), cases: caseRows.map(toCaseRecord) };
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function getEvalDatasetSnapshot(
  datasetId: string,
): Promise<EvalDatasetSnapshot | null> {
  return db.transaction(
    async (tx) => {
      const [row] = await tx
        .select()
        .from(evalDatasets)
        .where(eq(evalDatasets.id, datasetId))
        .limit(1);
      if (!row) return null;
      const caseRows = await readCaseRows(tx, datasetId);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        datasetHash: row.datasetHash,
        cases: caseRows.map(evalCaseFromColumns),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

/**
 * Create a dataset, optionally with initial cases (the JSON-import-on-create
 * path). The MAX_GOLDSET_CASES cap and in-batch case_key uniqueness are
 * enforced here — creation is one of the three mandatory enforcement points.
 */
export async function createEvalDataset(input: {
  name: string;
  description?: string;
  cases: EvalCase[];
}): Promise<EvalDatasetWriteResult> {
  const incoming = input.cases;
  const duplicateCaseKeys = duplicateKeysWithin(incoming);
  const counts = { limit: MAX_GOLDSET_CASES, existingCount: 0, incomingCount: incoming.length };
  if (duplicateCaseKeys.length > 0) {
    return { kind: "case_key_conflict", duplicateCaseKeys, ...counts };
  }
  if (incoming.length > MAX_GOLDSET_CASES) {
    return { kind: "limit_exceeded", duplicateCaseKeys: [], ...counts };
  }

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(evalDatasets)
        .values({
          name: input.name,
          description: input.description ?? null,
          datasetHash: hashDataset([]),
          caseCount: 0,
        })
        .returning({ id: evalDatasets.id });
      if (!created) throw new Error("Failed to create eval dataset");
      await insertCases(tx, created.id, incoming, 0);
      return finalizeDataset(tx, created.id);
    });
  } catch (e) {
    if (isUniqueNameViolation(e)) return { kind: "duplicate_name" };
    throw e;
  }
}

export async function updateEvalDatasetMeta(
  id: string,
  patch: { name?: string; description?: string | null },
  expectedRevision: number,
): Promise<EvalDatasetWriteResult> {
  try {
    return await db.transaction(async (tx) => {
      const gate = await lockDatasetAt(tx, id, expectedRevision);
      if (!gate.ok) return gate.failure;
      await tx
        .update(evalDatasets)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(evalDatasets.id, id));
      return finalizeDataset(tx, id);
    });
  } catch (e) {
    if (isUniqueNameViolation(e)) return { kind: "duplicate_name" };
    throw e;
  }
}

/** Cases go with it (FK CASCADE); historical runs keep their snapshot name/hash with dataset_id nulled (FK SET NULL). */
export async function deleteEvalDataset(
  id: string,
  expectedRevision: number,
): Promise<
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "dataset_changed"; currentRevision: number; currentHash: string }
> {
  return db.transaction(async (tx) => {
    const gate = await lockDatasetAt(tx, id, expectedRevision);
    if (!gate.ok) return gate.failure;
    await tx.delete(evalDatasets).where(eq(evalDatasets.id, id));
    return { kind: "ok" } as const;
  });
}

/**
 * Atomic append — single add (array of one) and JSON batch import share this
 * path. Any duplicate case_key (within the batch or against stored rows) or a
 * cap violation rejects the whole batch; nothing is written.
 */
export async function addEvalCases(
  datasetId: string,
  incoming: EvalCase[],
  expectedRevision: number,
): Promise<EvalDatasetWriteResult> {
  return db.transaction(async (tx) => {
    const gate = await lockDatasetAt(tx, datasetId, expectedRevision);
    if (!gate.ok) return gate.failure;

    const existingRows = await readCaseRows(tx, datasetId);
    const counts = {
      limit: MAX_GOLDSET_CASES,
      existingCount: existingRows.length,
      incomingCount: incoming.length,
    };

    const existingKeys = new Set(existingRows.map((r) => r.caseKey));
    const duplicateCaseKeys = [
      ...new Set([
        ...duplicateKeysWithin(incoming),
        ...incoming.map((c) => c.id).filter((k) => existingKeys.has(k)),
      ]),
    ];
    if (duplicateCaseKeys.length > 0) {
      return { kind: "case_key_conflict", duplicateCaseKeys, ...counts } as const;
    }
    if (existingRows.length + incoming.length > MAX_GOLDSET_CASES) {
      return { kind: "limit_exceeded", duplicateCaseKeys: [], ...counts } as const;
    }

    await insertCases(tx, datasetId, incoming, existingRows.length);
    return finalizeDataset(tx, datasetId);
  });
}

/** Full-case replacement of one row (idx preserved). `caseId` is the eval_cases UUID. */
export async function updateEvalCase(
  datasetId: string,
  caseId: string,
  next: EvalCase,
  expectedRevision: number,
): Promise<EvalDatasetWriteResult> {
  return db.transaction(async (tx) => {
    const gate = await lockDatasetAt(tx, datasetId, expectedRevision);
    if (!gate.ok) return gate.failure;

    const [target] = await tx
      .select()
      .from(evalCases)
      .where(and(eq(evalCases.id, caseId), eq(evalCases.datasetId, datasetId)))
      .limit(1);
    if (!target) return { kind: "case_not_found" } as const;

    if (next.id !== target.caseKey) {
      const [conflict] = await tx
        .select({ id: evalCases.id })
        .from(evalCases)
        .where(and(eq(evalCases.datasetId, datasetId), eq(evalCases.caseKey, next.id)))
        .limit(1);
      if (conflict) {
        return {
          kind: "case_key_conflict",
          duplicateCaseKeys: [next.id],
          limit: MAX_GOLDSET_CASES,
          existingCount: gate.row.caseCount,
          incomingCount: 1,
        } as const;
      }
    }

    await tx.update(evalCases).set(evalCaseToColumns(next)).where(eq(evalCases.id, caseId));
    return finalizeDataset(tx, datasetId);
  });
}

/** Delete one case and compact idx to 0..n-1 (order otherwise preserved). */
export async function deleteEvalCase(
  datasetId: string,
  caseId: string,
  expectedRevision: number,
): Promise<EvalDatasetWriteResult> {
  return db.transaction(async (tx) => {
    const gate = await lockDatasetAt(tx, datasetId, expectedRevision);
    if (!gate.ok) return gate.failure;

    const deleted = await tx
      .delete(evalCases)
      .where(and(eq(evalCases.id, caseId), eq(evalCases.datasetId, datasetId)))
      .returning({ id: evalCases.id });
    if (deleted.length === 0) return { kind: "case_not_found" } as const;

    const remaining = await readCaseRows(tx, datasetId);
    for (let i = 0; i < remaining.length; i += 1) {
      if (remaining[i].idx !== i) {
        await tx.update(evalCases).set({ idx: i }).where(eq(evalCases.id, remaining[i].id));
      }
    }
    return finalizeDataset(tx, datasetId);
  });
}
