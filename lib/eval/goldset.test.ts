import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canCompare, evalCaseFromColumns, evalCaseToColumns } from './goldset';
import { hashDataset } from './hash';
import { SEED_EVAL_DATASETS } from './dataset';
import type { EvalCase, EvalRunSummary } from './../types';

const fullCase: EvalCase = {
  id: 'case-full',
  question: 'Who leads the program?',
  expectedKeywords: ['kovacs'],
  category: 'single_fact',
  difficulty: 'easy',
  targetFileNames: ['sample.txt'],
  targetChunkSubstrings: ['Dr. Elena Kovacs'],
  expectedAnswer: 'Dr. Elena Kovacs.',
  notes: 'direct lookup',
};

const minimalCase: EvalCase = {
  id: 'case-min',
  question: 'Anything on staffing?',
  expectedKeywords: [],
  category: 'out_of_scope',
  difficulty: 'medium',
};

test('column round trip preserves a fully-specified case and its hash', () => {
  const roundTripped = evalCaseFromColumns(evalCaseToColumns(fullCase));
  assert.deepEqual(roundTripped, fullCase);
  assert.equal(hashDataset([roundTripped]), hashDataset([fullCase]));
});

test('absent optional fields come back omitted, not undefined (hash-critical)', () => {
  const roundTripped = evalCaseFromColumns(evalCaseToColumns(minimalCase));
  assert.equal('expectedAnswer' in roundTripped, false);
  assert.equal('notes' in roundTripped, false);
  assert.deepEqual(roundTripped.targetFileNames, []);
  assert.deepEqual(roundTripped.targetChunkSubstrings, []);
});

test('column normalization is a fixed point: a second round trip changes nothing', () => {
  const once = evalCaseFromColumns(evalCaseToColumns(minimalCase));
  const twice = evalCaseFromColumns(evalCaseToColumns(once));
  assert.deepEqual(twice, once);
  assert.equal(hashDataset([twice]), hashDataset([once]));
});

// The seed datasets fully specify every field, so their stored legacy hashes
// (written by the old code→DB upsert) must survive the DB round trip bit-for-bit.
for (const seed of SEED_EVAL_DATASETS) {
  test(`seed dataset "${seed.name}" hash survives the column round trip`, () => {
    const roundTripped = seed.cases.map((c) => evalCaseFromColumns(evalCaseToColumns(c)));
    assert.equal(hashDataset(roundTripped), hashDataset(seed.cases));
  });
}

function runSummary(overrides: Partial<EvalRunSummary>): EvalRunSummary {
  return {
    id: 'r1',
    knowledgeBaseId: 'kb1',
    datasetId: 'd1',
    datasetName: 'olympus',
    datasetHash: 'h1',
    mode: 'curated',
    useRerank: true,
    totalCases: 10,
    passedCases: 8,
    retrievalHitRate: 0.8,
    citationHitRate: 0.8,
    avgLatencyMs: 100,
    recallAtK: null,
    precisionAtK: null,
    ndcgAtK: null,
    mrr: null,
    avgFaithfulness: null,
    avgAnswerRelevance: null,
    filter: null,
    createdAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  };
}

test('canCompare: equal hashes compare, regardless of datasetId', () => {
  const a = runSummary({ datasetHash: 'same', datasetId: 'd1' });
  const b = runSummary({ id: 'r2', datasetHash: 'same', datasetId: null });
  assert.equal(canCompare(a, b), true);
});

test('canCompare: different or missing hashes do not compare', () => {
  const a = runSummary({ datasetHash: 'h1' });
  assert.equal(canCompare(a, runSummary({ id: 'r2', datasetHash: 'h2' })), false);
  assert.equal(canCompare(a, runSummary({ id: 'r3', datasetHash: null })), false);
  assert.equal(
    canCompare(runSummary({ datasetHash: null }), runSummary({ id: 'r4', datasetHash: null })),
    false,
  );
});
