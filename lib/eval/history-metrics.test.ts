import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvalRunDetail } from '../types';
import { detailToResult, metricsFromResult, metricsFromSummary, METRIC_SPECS, metricDelta } from '../../app/(app)/eval/_components/shared';

const legacyRun: EvalRunDetail = {
  id: 'legacy-run', knowledgeBaseId: 'kb', datasetId: null, datasetName: null,
  datasetHash: null, mode: 'curated', useRerank: true, totalCases: 10,
  passedCases: 9, retrievalHitRate: 0.9, citationHitRate: 0.8, avgLatencyMs: 100,
  hitAtK: null, recallAtK: { 1: 0.7, 3: 0.9, 5: 0.9 },
  precisionAtK: null, ndcgAtK: null, mrr: null, avgFaithfulness: null,
  avgAnswerRelevance: null, filter: null, createdAt: '2026-07-10T00:00:00Z', items: [],
};

test('history keeps original legacy values separate through summary and detail rendering', () => {
  const summary = metricsFromSummary(legacyRun);
  const detail = metricsFromResult(detailToResult(legacyRun));
  assert.equal(summary.hit, null);
  assert.equal(summary.legacyHit, 0.9);
  assert.deepEqual(detail, summary);
  assert.deepEqual(detailToResult(legacyRun).recallAtK, legacyRun.recallAtK);
  const spec = METRIC_SPECS.find(s => s.key === 'legacyHit')!;
  assert.equal(spec.labelKey, 'legacyHitAtK');
});

test('new runs use Hit@K and do not compute deltas against the old mixed-case score', () => {
  const current = { ...legacyRun, hitAtK: { 5: 0.5 }, recallAtK: null };
  const metrics = metricsFromSummary(current);
  assert.equal(metrics.hit, 0.5);
  assert.equal(metrics.legacyHit, null);
  assert.deepEqual(metricsFromResult(detailToResult(current)), metrics);
  const spec = METRIC_SPECS.find(s => s.key === 'hit')!;
  assert.equal(metricDelta(spec, metrics, metricsFromSummary(legacyRun)), undefined);
});
