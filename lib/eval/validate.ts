import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadDataset } from '@/lib/eval/dataset';
import type { EvalCase, EvalCaseCategory, EvalCaseDifficulty } from '@/lib/types';

/**
 * Golden-set linter.
 *
 * Validates each curated `EvalCase` against the on-disk source fixtures it was
 * authored against (`tests/fixtures/*`). The match rules MIRROR `gradeChunk`
 * (lib/eval/relevance.ts) exactly, so a clean case means the grading signals can
 * actually fire at eval time:
 *   - grade 3 = chunk text `.includes(targetChunkSubstrings[i])` (case-sensitive)
 *   - grade 2 = file ∈ targetFileNames AND text (lowercased) includes a lowercased keyword
 * A broken substring/keyword silently caps a case's grade and deflates
 * Recall@K / Precision@K / nDCG / MRR — this linter surfaces that before a run.
 *
 * Keep the case-sensitivity rules below in lockstep with `gradeChunk`.
 */

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures');

const VALID_CATEGORIES: ReadonlySet<string> = new Set<EvalCaseCategory>([
  'single_fact',
  'numeric_fact',
  'list_extraction',
  'synthesis',
  'disambiguation',
  'out_of_scope',
]);

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set<EvalCaseDifficulty>([
  'easy',
  'medium',
  'hard',
]);

export type DatasetIssueSeverity = 'error' | 'warning';

export type DatasetIssueCode =
  | 'missing_id'
  | 'duplicate_id'
  | 'missing_question'
  | 'invalid_category'
  | 'invalid_difficulty'
  | 'target_file_missing'
  | 'substring_not_in_source'
  | 'keyword_not_in_source'
  | 'keyword_not_in_expected_answer'
  | 'empty_keywords'
  | 'no_targets'
  | 'out_of_scope_has_targets';

export type DatasetIssueField =
  | 'id'
  | 'question'
  | 'category'
  | 'difficulty'
  | 'expectedKeywords'
  | 'targetFileNames'
  | 'targetChunkSubstrings'
  | 'expectedAnswer';

export interface DatasetIssue {
  code: DatasetIssueCode;
  severity: DatasetIssueSeverity;
  /** The EvalCase field the issue concerns, for UI grouping. */
  field?: DatasetIssueField;
  /** Offending value (filename, substring, keyword, …) for templated messages. */
  value?: string;
}

export interface DatasetCaseReport {
  caseId: string;
  question: string;
  category: EvalCaseCategory;
  difficulty: EvalCaseDifficulty;
  issues: DatasetIssue[];
  errorCount: number;
  warningCount: number;
}

export interface DatasetValidationResult {
  datasetName: string;
  /** Fixture files the dataset references, with on-disk existence flags. */
  files: { name: string; exists: boolean }[];
  totalCases: number;
  errorCount: number;
  warningCount: number;
  okCount: number;
  cases: DatasetCaseReport[];
}

/** Read a fixture once; returns null (not throwing) when the file is absent. */
async function readFixtures(
  fileNames: Iterable<string>,
): Promise<Map<string, string | null>> {
  const cache = new Map<string, string | null>();
  await Promise.all(
    [...new Set(fileNames)].map(async name => {
      try {
        cache.set(name, await readFile(join(FIXTURES_DIR, name), 'utf8'));
      } catch {
        cache.set(name, null);
      }
    }),
  );
  return cache;
}

function validateCase(
  c: EvalCase,
  fixtures: Map<string, string | null>,
  duplicateIds: ReadonlySet<string>,
): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const targetFiles = c.targetFileNames ?? [];
  const substrings = c.targetChunkSubstrings ?? [];
  const keywords = c.expectedKeywords ?? [];
  const isOutOfScope = c.category === 'out_of_scope';

  // ── structural / enum ──
  if (!c.id || !c.id.trim()) {
    issues.push({ code: 'missing_id', severity: 'error', field: 'id' });
  } else if (duplicateIds.has(c.id)) {
    issues.push({ code: 'duplicate_id', severity: 'error', field: 'id', value: c.id });
  }
  if (!c.question || !c.question.trim()) {
    issues.push({ code: 'missing_question', severity: 'error', field: 'question' });
  }
  if (!VALID_CATEGORIES.has(c.category)) {
    issues.push({ code: 'invalid_category', severity: 'error', field: 'category', value: String(c.category) });
  }
  if (!VALID_DIFFICULTIES.has(c.difficulty)) {
    issues.push({ code: 'invalid_difficulty', severity: 'error', field: 'difficulty', value: String(c.difficulty) });
  }

  // ── target files exist on disk ──
  const presentFiles: string[] = [];
  for (const name of targetFiles) {
    if (fixtures.get(name)) {
      presentFiles.push(name);
    } else {
      issues.push({ code: 'target_file_missing', severity: 'error', field: 'targetFileNames', value: name });
    }
  }

  // Concatenated source text of the case's *existing* target files.
  const source = presentFiles.map(name => fixtures.get(name) ?? '').join('\n');
  const sourceLower = source.toLowerCase();
  const canCheckSource = presentFiles.length > 0;

  // ── substring grounding (grade-3 signal; case-sensitive, mirrors gradeChunk) ──
  if (canCheckSource) {
    for (const sub of substrings) {
      if (sub && !source.includes(sub)) {
        issues.push({ code: 'substring_not_in_source', severity: 'error', field: 'targetChunkSubstrings', value: sub });
      }
    }
  }

  // ── keyword grounding (grade-2 signal; case-insensitive) ──
  if (canCheckSource) {
    for (const kw of keywords) {
      if (kw && !sourceLower.includes(kw.toLowerCase())) {
        issues.push({ code: 'keyword_not_in_source', severity: 'warning', field: 'expectedKeywords', value: kw });
      }
    }
  }

  // ── keyword ↔ expected answer drift ──
  if (c.expectedAnswer) {
    const answerLower = c.expectedAnswer.toLowerCase();
    for (const kw of keywords) {
      if (kw && !answerLower.includes(kw.toLowerCase())) {
        issues.push({ code: 'keyword_not_in_expected_answer', severity: 'warning', field: 'expectedKeywords', value: kw });
      }
    }
  }

  // ── completeness (out_of_scope cases are intentionally empty) ──
  if (!isOutOfScope) {
    if (keywords.length === 0) {
      issues.push({ code: 'empty_keywords', severity: 'warning', field: 'expectedKeywords' });
    }
    if (targetFiles.length === 0 && substrings.length === 0) {
      issues.push({ code: 'no_targets', severity: 'warning', field: 'targetFileNames' });
    }
  } else if (targetFiles.length > 0 || substrings.length > 0) {
    issues.push({ code: 'out_of_scope_has_targets', severity: 'warning', field: 'targetChunkSubstrings' });
  }

  return issues;
}

export async function validateDataset(
  name: string,
): Promise<DatasetValidationResult> {
  const cases = loadDataset(name);

  // Ids that appear more than once within the dataset (each reported as duplicate).
  const idCounts = new Map<string, number>();
  for (const c of cases) {
    if (c.id) idCounts.set(c.id, (idCounts.get(c.id) ?? 0) + 1);
  }
  const duplicateIds = new Set(
    [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id),
  );

  const referencedFiles = cases.flatMap(c => c.targetFileNames ?? []);
  const fixtures = await readFixtures(referencedFiles);

  let errorCount = 0;
  let warningCount = 0;
  let okCount = 0;

  const caseReports: DatasetCaseReport[] = cases.map(c => {
    const issues = validateCase(c, fixtures, duplicateIds);
    const e = issues.filter(i => i.severity === 'error').length;
    const w = issues.length - e;
    errorCount += e;
    warningCount += w;
    if (issues.length === 0) okCount += 1;
    return {
      caseId: c.id,
      question: c.question,
      category: c.category,
      difficulty: c.difficulty,
      issues,
      errorCount: e,
      warningCount: w,
    };
  });

  const files = [...new Set(referencedFiles)].map(name => ({
    name,
    exists: Boolean(fixtures.get(name)),
  }));

  return {
    datasetName: name,
    files,
    totalCases: cases.length,
    errorCount,
    warningCount,
    okCount,
    cases: caseReports,
  };
}
