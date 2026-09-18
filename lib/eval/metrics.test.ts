import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateMetrics, hitAtK, precisionAtK } from './metrics';

const answerable = (grades: number[]) => ({ grades, outOfScope: false });

test('one of three relevant evidence chunks in five results: Hit@5 = 1, Precision@5 = 1/5', () => {
  // Complete annotations would give Recall@5 = 1/3. Our grades alone cannot
  // encode the two missing chunks, so we deliberately do not compute Recall.
  const input = answerable([0, 2, 0, 1, 0]);
  assert.equal(hitAtK(input, 5), 1);
  assert.equal(precisionAtK(input, 5), 1 / 5);
});

test('a relevant result after K does not count; the Kth result does', () => {
  const input = answerable([0, 1, 0, 0, 0, 3]);
  assert.equal(hitAtK(input, 5), 0);
  assert.equal(hitAtK(input, 6), 1);
});

test('empty retrieval and grades below 2 are misses', () => {
  assert.equal(hitAtK(answerable([]), 5), 0);
  assert.equal(hitAtK(answerable([0, 1, 1]), 5), 0);
  assert.equal(hitAtK(answerable([2, 3]), 0), 0);
});

test('Hit@K excludes unanswerable cases from both numerator and denominator', () => {
  const cases = [answerable([2]), answerable([])];
  const baseline = aggregateMetrics(cases, [1, 3, 5]).hitAtK;
  assert.deepEqual(baseline, { 1: 0.5, 3: 0.5, 5: 0.5 });
  for (const grades of [[], [0], [3]]) {
    const oos = { grades, outOfScope: true };
    // Refusals are evaluated separately by the runner, never rewarded as hits.
    assert.equal(hitAtK(oos, 5), 0);
    assert.deepEqual(aggregateMetrics([...cases, oos], [1, 3, 5]).hitAtK, baseline);
  }
});

test('empty datasets and refusal-only datasets report no Hit@K at all', () => {
  // A zero here would be persisted and rendered as "0%" — indistinguishable
  // from total retrieval failure. null renders as "—" and skips the delta.
  for (const cases of [[], [{ grades: [], outOfScope: true }], [{ grades: [3], outOfScope: true }]]) {
    assert.equal(aggregateMetrics(cases, [1, 3, 5]).hitAtK, null);
  }
});
