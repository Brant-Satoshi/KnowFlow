import { isOutOfScope } from '@/lib/eval/dataset';
import {
  EVAL_CASE_CATEGORIES,
  EVAL_CASE_DIFFICULTIES,
  MAX_GOLDSET_CASES,
} from '@/lib/validation';
import type { EvalCase, GoldsetIssue, RetrievalFilter } from '@/lib/types';

/* ────────────────────────────────────────────────────────────────────────────
 * Managed-goldset validation: two layers.
 *
 * Layer 1 — structural lint (pure, KB-independent): required fields, enum
 * values, duplicate case_keys, the MAX_GOLDSET_CASES cap, and `no_targets` as
 * an ERROR: a non-out_of_scope case with neither targetFileNames nor
 * targetChunkSubstrings cannot produce a trustworthy retrieval ground truth,
 * so it must not run.
 *
 * Layer 2 — KB compatibility (filter-aware preflight): checks the same
 * grading signals as `gradeChunk` (lib/eval/relevance.ts) against the KB the
 * run would actually hit. The effective corpus is: files with
 * status='indexed' whose chunks have embeddings, narrowed by the run's
 * RetrievalFilter via the same SQL clauses retrieval uses.
 *
 * A dataset may run against a KB iff neither layer reports an error.
 * Warnings never block.
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
