import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isOutOfScope, loadDataset } from '@/lib/eval/dataset';
import {
  EVAL_CASE_CATEGORIES,
  EVAL_CASE_DIFFICULTIES,
  MAX_GOLDSET_CASES,
} from '@/lib/validation';
import type {
  EvalCase,
  EvalCaseCategory,
  EvalCaseDifficulty,
  GoldsetIssue,
  RetrievalFilter,
} from '@/lib/types';

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
  const outOfScope = isOutOfScope(c);

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
  if (!outOfScope) {
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

/* ────────────────────────────────────────────────────────────────────────────
 * Managed-goldset validation: two layers.
 *
 * Layer 1 — structural lint (pure, KB-independent): required fields, enum
 * values, duplicate case_keys, the MAX_GOLDSET_CASES cap, and — unlike the
 * legacy linter above — `no_targets` as an ERROR: a non-out_of_scope case with
 * neither targetFileNames nor targetChunkSubstrings cannot produce a
 * trustworthy retrieval ground truth, so it must not run.
 *
 * Layer 2 — KB compatibility (filter-aware preflight): checks the same
 * grading signals as `gradeChunk` (lib/eval/relevance.ts) against the KB the
 * run would actually hit. The effective corpus is: files with
 * status='indexed' whose chunks have embeddings, narrowed by the run's
 * RetrievalFilter via the same SQL clauses retrieval uses.
 *
 * A dataset may run against a KB iff neither layer reports an error.
 * Warnings never block. (The fixture-based validateDataset above is
 * superseded and removed together with its UI.)
 * ──────────────────────────────────────────────────────────────────────────── */

const CATEGORY_SET: ReadonlySet<string> = new Set(EVAL_CASE_CATEGORIES);
const DIFFICULTY_SET: ReadonlySet<string> = new Set(EVAL_CASE_DIFFICULTIES);

/** Structural lint over a case list (dataset-level issues carry no caseKey). */
export function lintGoldset(cases: EvalCase[]): GoldsetIssue[] {
  const issues: GoldsetIssue[] = [];

  if (cases.length === 0) {
    issues.push({ code: 'empty_dataset', severity: 'error' });
  }
  if (cases.length > MAX_GOLDSET_CASES) {
    issues.push({ code: 'over_limit', severity: 'error', value: String(cases.length) });
  }

  const keyCounts = new Map<string, number>();
  for (const c of cases) {
    if (c.id) keyCounts.set(c.id, (keyCounts.get(c.id) ?? 0) + 1);
  }
  const duplicated = new Set(
    [...keyCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  );

  for (const c of cases) {
    const caseKey = c.id || undefined;

    if (!c.id || !c.id.trim()) {
      issues.push({ code: 'missing_id', severity: 'error', caseKey });
    } else if (duplicated.has(c.id)) {
      issues.push({ code: 'duplicate_id', severity: 'error', caseKey, value: c.id });
    }
    if (!c.question || !c.question.trim()) {
      issues.push({ code: 'missing_question', severity: 'error', caseKey });
    }
    if (!CATEGORY_SET.has(c.category)) {
      issues.push({ code: 'invalid_category', severity: 'error', caseKey, value: String(c.category) });
    }
    if (!DIFFICULTY_SET.has(c.difficulty)) {
      issues.push({ code: 'invalid_difficulty', severity: 'error', caseKey, value: String(c.difficulty) });
    }

    const keywords = c.expectedKeywords ?? [];
    const targetCount =
      (c.targetFileNames ?? []).length + (c.targetChunkSubstrings ?? []).length;
    const outOfScope = isOutOfScope(c);

    if (!outOfScope) {
      if (keywords.length === 0) {
        issues.push({ code: 'empty_keywords', severity: 'warning', caseKey });
      }
      if (targetCount === 0) {
        issues.push({ code: 'no_targets', severity: 'error', caseKey });
      }
    } else if (targetCount > 0) {
      issues.push({ code: 'out_of_scope_has_targets', severity: 'warning', caseKey });
    }

    if (c.expectedAnswer) {
      const answerLower = c.expectedAnswer.toLowerCase();
      for (const kw of keywords) {
        if (kw && !answerLower.includes(kw.toLowerCase())) {
          issues.push({ code: 'keyword_not_in_expected_answer', severity: 'warning', caseKey, value: kw });
        }
      }
    }
  }

  return issues;
}

/** What the preflight needs to know about a knowledge base. */
export interface KbCorpus {
  /** Names of files with status='indexed' (filter NOT applied). */
  indexedFileNames: ReadonlySet<string>;
  /** Indexed file names reachable through at least one embedded chunk, before the filter. */
  recallableFileNames: ReadonlySet<string>;
  /** Chunks that survive the RetrievalFilter — the effective corpus. */
  effectiveChunks: readonly { fileName: string; text: string }[];
}

/**
 * KB-compatibility preflight (pure core). Match rules mirror `gradeChunk`:
 * substrings are case-sensitive `.includes` against any effective chunk
 * (grade-3 wins file-independently); keywords are case-insensitive against
 * chunks of the case's own effective target files (the grade-2 signal).
 */
export function preflightGoldsetCases(
  cases: EvalCase[],
  corpus: KbCorpus,
): GoldsetIssue[] {
  const issues: GoldsetIssue[] = [];
  const effectiveFileNames = new Set(corpus.effectiveChunks.map((c) => c.fileName));

  for (const c of cases) {
    if (isOutOfScope(c)) continue;
    const caseKey = c.id;

    const effectiveTargets = new Set<string>();
    for (const name of c.targetFileNames ?? []) {
      if (!corpus.indexedFileNames.has(name) || !corpus.recallableFileNames.has(name)) {
        issues.push({ code: 'target_file_missing', severity: 'error', caseKey, value: name });
      } else if (!effectiveFileNames.has(name)) {
        issues.push({ code: 'target_file_excluded_by_filter', severity: 'error', caseKey, value: name });
      } else {
        effectiveTargets.add(name);
      }
    }

    for (const sub of c.targetChunkSubstrings ?? []) {
      if (sub && !corpus.effectiveChunks.some((ch) => ch.text.includes(sub))) {
        issues.push({ code: 'substring_not_in_source', severity: 'error', caseKey, value: sub });
      }
    }

    if (effectiveTargets.size > 0) {
      const targetTextsLower = corpus.effectiveChunks
        .filter((ch) => effectiveTargets.has(ch.fileName))
        .map((ch) => ch.text.toLowerCase());
      for (const kw of c.expectedKeywords ?? []) {
        if (kw && !targetTextsLower.some((t) => t.includes(kw.toLowerCase()))) {
          issues.push({ code: 'keyword_not_in_source', severity: 'warning', caseKey, value: kw });
        }
      }
    }
  }

  return issues;
}

/**
 * Load the preflight corpus for a KB. DB modules are imported lazily so this
 * file stays importable in DB-less unit tests (lib/db/pg.ts throws at import
 * time when DATABASE_URL is unset).
 */
export async function loadKbCorpus(
  knowledgeBaseId: string,
  filter?: RetrievalFilter,
): Promise<KbCorpus> {
  const [{ listIndexedFileNames }, { listCorpusChunks }] = await Promise.all([
    import('@/lib/db/files'),
    import('@/lib/db/chunks'),
  ]);

  const hasFilter = Boolean(
    filter && (filter.fileIds?.length || filter.fileTypes?.length || filter.titleQuery),
  );
  const [indexedNames, allChunks, filteredChunks] = await Promise.all([
    listIndexedFileNames(knowledgeBaseId),
    listCorpusChunks(knowledgeBaseId, undefined),
    hasFilter ? listCorpusChunks(knowledgeBaseId, filter) : null,
  ]);

  return {
    indexedFileNames: new Set(indexedNames),
    recallableFileNames: new Set(allChunks.map((c) => c.fileName)),
    effectiveChunks: filteredChunks ?? allChunks,
  };
}

/** Filter-aware KB-compatibility preflight over a dataset snapshot. */
export async function preflightDataset(opts: {
  datasetSnapshot: { cases: EvalCase[] };
  knowledgeBaseId: string;
  filter?: RetrievalFilter;
}): Promise<GoldsetIssue[]> {
  const corpus = await loadKbCorpus(opts.knowledgeBaseId, opts.filter);
  return preflightGoldsetCases(opts.datasetSnapshot.cases, corpus);
}

export function hasGoldsetErrors(issues: GoldsetIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
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
