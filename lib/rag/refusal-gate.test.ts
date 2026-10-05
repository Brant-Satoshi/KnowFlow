import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Chunk } from '@/lib/types';
import { assessRetrieval, CALIBRATED_RERANK_MODEL, maxRerankScore } from './refusal-gate';

const OPTS = { minRerankScore: 0.1, rerankModel: CALIBRATED_RERANK_MODEL };

function chunk(rerankScore?: number): Chunk {
  return {
    id: crypto.randomUUID(),
    fileId: 'f1',
    idx: 0,
    text: 'text',
    meta: rerankScore === undefined ? {} : { _rerankScore: rerankScore },
  };
}

test('empty retrieval is refused', () => {
  assert.equal(assessRetrieval('who is the lead researcher?', [], OPTS), 'empty');
});

test('a conversation recap is exempt from the empty-retrieval refusal', () => {
  // buildPrompt answers these from history alone, so zero chunks is expected.
  assert.equal(assessRetrieval('总结一下', [], OPTS), null);
  assert.equal(assessRetrieval('summarize this conversation', [], OPTS), null);
});

test('a topical summary with nothing retrieved is still refused', () => {
  // The trap: it matches the loose summary keyword, but answering it from chat
  // history would silently swap the question for one the user never asked.
  assert.equal(assessRetrieval('Summarize information about Olympus', [], OPTS), 'empty');
  assert.equal(assessRetrieval('总结一下知识库里关于奥林匹斯的内容', [], OPTS), 'empty');
});

test('chunks all below the floor are refused as low_score', () => {
  assert.equal(assessRetrieval('q', [chunk(0.02), chunk(0.05)], OPTS), 'low_score');
});

test('one chunk at or above the floor lets the turn through', () => {
  assert.equal(assessRetrieval('q', [chunk(0.02), chunk(0.4)], OPTS), null);
  assert.equal(assessRetrieval('q', [chunk(0.1)], OPTS), null);
});

test('the floor is inert when nothing carries a rerank score', () => {
  // Rerank off, degraded to recall order, or short-circuited on a single chunk:
  // there is no score to compare, so recall's distance ceiling stays the only guard.
  assert.equal(assessRetrieval('q', [chunk(), chunk()], OPTS), null);
});

test('the floor is inert for a reranker it was not calibrated against', () => {
  // A 0.02 from another model means something else entirely.
  const other = { minRerankScore: 0.1, rerankModel: 'some-other/reranker-v1' };
  assert.equal(assessRetrieval('q', [chunk(0.02)], other), null);
});

test('minRerankScore <= 0 disables the floor but not the empty refusal', () => {
  const off = { minRerankScore: 0, rerankModel: CALIBRATED_RERANK_MODEL };
  assert.equal(assessRetrieval('q', [chunk(0.001)], off), null);
  assert.equal(assessRetrieval('q', [], off), 'empty');
});

test('maxRerankScore ignores unscored chunks and reports null when there are none', () => {
  assert.equal(maxRerankScore([chunk(0.2), chunk(), chunk(0.7)]), 0.7);
  assert.equal(maxRerankScore([chunk(), chunk()]), null);
  assert.equal(maxRerankScore([]), null);
});
