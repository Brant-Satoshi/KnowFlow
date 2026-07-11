import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintGoldset, preflightGoldsetCases, hasGoldsetErrors, type KbCorpus } from './validate';
import type { EvalCase, GoldsetIssue } from './../types';

function makeCase(overrides: Partial<EvalCase>): EvalCase {
  return {
    id: 'case-1',
    question: 'Who leads the program?',
    expectedKeywords: ['kovacs'],
    category: 'single_fact',
    difficulty: 'easy',
    targetFileNames: ['a.txt'],
    targetChunkSubstrings: ['Dr. Elena Kovacs'],
    expectedAnswer: 'Dr. Elena Kovacs leads it.',
    ...overrides,
  };
}

function codes(issues: GoldsetIssue[]): string[] {
  return issues.map((i) => i.code);
}

/* ── structural lint ── */

test('lint: a well-formed case list is clean', () => {
  assert.deepEqual(lintGoldset([makeCase({})]), []);
});

test('lint: empty dataset is an error', () => {
  assert.deepEqual(codes(lintGoldset([])), ['empty_dataset']);
});

test('lint: over the 50-case cap is an error', () => {
  const cases = Array.from({ length: 51 }, (_, i) => makeCase({ id: `case-${i}` }));
  assert.ok(codes(lintGoldset(cases)).includes('over_limit'));
});

test('lint: exactly 50 cases is allowed', () => {
  const cases = Array.from({ length: 50 }, (_, i) => makeCase({ id: `case-${i}` }));
  assert.equal(codes(lintGoldset(cases)).includes('over_limit'), false);
});

test('lint: non-out_of_scope case without any target is an ERROR (upgraded from warning)', () => {
  const issues = lintGoldset([
    makeCase({ targetFileNames: [], targetChunkSubstrings: [] }),
  ]);
  const noTargets = issues.find((i) => i.code === 'no_targets');
  assert.ok(noTargets);
  assert.equal(noTargets.severity, 'error');
});

test('lint: out_of_scope case is exempt from targets, flags declared targets as warning', () => {
  const clean = lintGoldset([
    makeCase({
      category: 'out_of_scope',
      expectedKeywords: [],
      targetFileNames: [],
      targetChunkSubstrings: [],
      expectedAnswer: undefined,
    }),
  ]);
  assert.deepEqual(clean, []);

  const withTargets = lintGoldset([
    makeCase({ category: 'out_of_scope', expectedKeywords: [], expectedAnswer: undefined }),
  ]);
  assert.deepEqual(codes(withTargets), ['out_of_scope_has_targets']);
  assert.equal(withTargets[0].severity, 'warning');
});

test('lint: duplicate case ids are errors on every duplicated case', () => {
  const issues = lintGoldset([makeCase({}), makeCase({ question: 'Different?' })]);
  assert.deepEqual(codes(issues.filter((i) => i.code === 'duplicate_id')), [
    'duplicate_id',
    'duplicate_id',
  ]);
});

test('lint: missing id/question and invalid enums are errors', () => {
  const issues = lintGoldset([
    makeCase({
      id: ' ',
      question: '',
      category: 'nope' as EvalCase['category'],
      difficulty: 'nope' as EvalCase['difficulty'],
    }),
  ]);
  for (const code of ['missing_id', 'missing_question', 'invalid_category', 'invalid_difficulty']) {
    assert.ok(codes(issues).includes(code), `expected ${code}`);
  }
  assert.ok(issues.every((i) => i.severity === 'error'));
});

test('lint: empty keywords and keyword/expected-answer drift are warnings', () => {
  const emptyKw = lintGoldset([makeCase({ expectedKeywords: [], expectedAnswer: undefined })]);
  assert.deepEqual(codes(emptyKw), ['empty_keywords']);
  assert.equal(emptyKw[0].severity, 'warning');

  const drift = lintGoldset([makeCase({ expectedAnswer: 'Someone else entirely.' })]);
  assert.deepEqual(codes(drift), ['keyword_not_in_expected_answer']);
  assert.equal(drift[0].severity, 'warning');
});

/* ── KB compatibility preflight ── */

const corpus: KbCorpus = {
  indexedFileNames: new Set(['a.txt', 'b.txt', 'chunkless.txt']),
  recallableFileNames: new Set(['a.txt', 'b.txt']),
  effectiveChunks: [
    { fileName: 'a.txt', text: 'Dr. Elena Kovacs leads the Olympus program.' },
    { fileName: 'a.txt', text: 'Funding totals 420 million credits.' },
  ],
};

test('preflight: compatible case produces no issues', () => {
  assert.deepEqual(preflightGoldsetCases([makeCase({})], corpus), []);
});

test('preflight: file absent from the KB is target_file_missing', () => {
  const issues = preflightGoldsetCases(
    [makeCase({ targetFileNames: ['ghost.txt'], targetChunkSubstrings: [] })],
    corpus,
  );
  assert.deepEqual(codes(issues), ['target_file_missing']);
  assert.equal(issues[0].value, 'ghost.txt');
});

test('preflight: indexed but chunkless file is not a valid corpus member', () => {
  const issues = preflightGoldsetCases(
    [makeCase({ targetFileNames: ['chunkless.txt'], targetChunkSubstrings: [] })],
    corpus,
  );
  // No effective target remains, so the keyword check is skipped — the file
  // error already explains why the case cannot ground.
  assert.deepEqual(codes(issues), ['target_file_missing']);
});

test('preflight: file excluded by the filter gets its own error code', () => {
  // b.txt is recallable in the KB but no effective chunk survives the filter.
  const issues = preflightGoldsetCases(
    [makeCase({ targetFileNames: ['b.txt'], targetChunkSubstrings: [] })],
    corpus,
  );
  assert.ok(codes(issues).includes('target_file_excluded_by_filter'));
});

test('preflight: substring must appear in an effective chunk, case-sensitively', () => {
  const missing = preflightGoldsetCases(
    [makeCase({ targetChunkSubstrings: ['dr. elena kovacs'] })],
    corpus,
  );
  assert.ok(codes(missing).includes('substring_not_in_source'));

  const present = preflightGoldsetCases(
    [makeCase({ targetChunkSubstrings: ['Dr. Elena Kovacs'] })],
    corpus,
  );
  assert.deepEqual(present, []);
});

test('preflight: keyword absent from the target files is a warning only', () => {
  const issues = preflightGoldsetCases(
    [makeCase({ expectedKeywords: ['nonexistent-term'], expectedAnswer: undefined })],
    corpus,
  );
  assert.deepEqual(codes(issues), ['keyword_not_in_source']);
  assert.equal(issues[0].severity, 'warning');
  assert.equal(hasGoldsetErrors(issues), false);
});

test('preflight: keyword match is case-insensitive (grade-2 mirror)', () => {
  const issues = preflightGoldsetCases(
    [makeCase({ expectedKeywords: ['KOVACS'], expectedAnswer: undefined })],
    corpus,
  );
  assert.deepEqual(issues, []);
});

test('preflight: out_of_scope cases are skipped entirely', () => {
  const issues = preflightGoldsetCases(
    [
      makeCase({
        category: 'out_of_scope',
        targetFileNames: ['ghost.txt'],
        targetChunkSubstrings: ['nowhere'],
      }),
    ],
    corpus,
  );
  assert.deepEqual(issues, []);
});

test('hasGoldsetErrors distinguishes errors from warnings', () => {
  assert.equal(hasGoldsetErrors([{ code: 'no_targets', severity: 'error' }]), true);
  assert.equal(hasGoldsetErrors([{ code: 'empty_keywords', severity: 'warning' }]), false);
  assert.equal(hasGoldsetErrors([]), false);
});
