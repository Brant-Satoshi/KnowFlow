import type {
  EvalCase,
  EvalCaseCategory,
  EvalCaseDifficulty,
  EvalRunSummary,
} from '@/lib/types';

/**
 * Pure mapping between the `eval_cases` column shape and the `EvalCase` JSON
 * shape. `dataset_hash` is always computed over cases produced by
 * {@link evalCaseFromColumns}, so this mapping is hash-critical: optional
 * fields must be *omitted* when absent (an explicit `undefined` would still be
 * serialized as a key by lib/eval/hash.ts canonicalization), and the array
 * fields are always present. This exactly reproduces what the legacy
 * code-defined datasets hashed to, keeping historical `dataset_hash` values
 * (and therefore run comparability) intact.
 */
export interface EvalCaseColumns {
  caseKey: string;
  question: string;
  expectedKeywords: string[];
  category: string;
  difficulty: string;
  targetFileNames: string[];
  targetChunkSubstrings: string[];
  expectedAnswer: string | null;
  notes: string | null;
}

export function evalCaseToColumns(c: EvalCase): EvalCaseColumns {
  return {
    caseKey: c.id,
    question: c.question,
    expectedKeywords: c.expectedKeywords ?? [],
    category: c.category,
    difficulty: c.difficulty,
    targetFileNames: c.targetFileNames ?? [],
    targetChunkSubstrings: c.targetChunkSubstrings ?? [],
    expectedAnswer: c.expectedAnswer ?? null,
    notes: c.notes ?? null,
  };
}

export function evalCaseFromColumns(row: EvalCaseColumns): EvalCase {
  const c: EvalCase = {
    id: row.caseKey,
    question: row.question,
    expectedKeywords: row.expectedKeywords ?? [],
    category: row.category as EvalCaseCategory,
    difficulty: row.difficulty as EvalCaseDifficulty,
    targetFileNames: row.targetFileNames ?? [],
    targetChunkSubstrings: row.targetChunkSubstrings ?? [],
  };
  if (row.expectedAnswer != null) c.expectedAnswer = row.expectedAnswer;
  if (row.notes != null) c.notes = row.notes;
  return c;
}

/**
 * Two runs are comparable iff both carry a dataset hash and the hashes match.
 * datasetId equality is deliberately NOT required: runs orphaned by a dataset
 * deletion keep their snapshot hash and stay comparable with each other.
 * Structurally typed so `EvalRunSummary` and a live `EvalRunResult` both fit.
 */
export function canCompare(
  a: Pick<EvalRunSummary, 'datasetHash'> | { datasetHash?: string | null },
  b: Pick<EvalRunSummary, 'datasetHash'> | { datasetHash?: string | null },
): boolean {
  return Boolean(a.datasetHash && b.datasetHash && a.datasetHash === b.datasetHash);
}
