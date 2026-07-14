import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RetrievedChunk } from '../types';
import {
  emitRefusal,
  isRefusalText,
  refusalTextFor,
  REFUSAL_TEXT_EN,
  REFUSAL_TEXT_ZH,
} from './refusal';

type Sent = { event: string; data: Record<string, unknown> };

function collector() {
  const sent: Sent[] = [];
  const send = (event: string, data: unknown) => {
    sent.push({ event, data: data as Record<string, unknown> });
  };
  return { sent, send: send as Parameters<typeof emitRefusal>[0] };
}

const CHUNKS: RetrievedChunk[] = [
  { index: 1, chunkId: 'c1', fileId: 'f1', fileName: 'sample.txt', quote: 'q' },
];

test('the refusal answers in the language of the question', () => {
  assert.equal(refusalTextFor('首席研究员是谁？'), REFUSAL_TEXT_ZH);
  assert.equal(refusalTextFor('who is the lead researcher?'), REFUSAL_TEXT_EN);
});

test('isRefusalText recognizes both texts, trimmed', () => {
  assert.equal(isRefusalText(`  ${REFUSAL_TEXT_ZH}\n`), true);
  assert.equal(isRefusalText(REFUSAL_TEXT_EN), true);
  assert.equal(isRefusalText('The lead researcher is Dr. Kovacs [1].'), false);
});

test('emitRefusal streams a refusal as an ordinary turn', async () => {
  const { sent, send } = collector();

  const text = await emitRefusal(send, {
    requestId: 'req-1',
    question: 'who is on staff?',
    retrievedChunks: [],
    reason: 'empty',
  });

  assert.equal(text, REFUSAL_TEXT_EN);
  assert.deepEqual(sent.map((s) => s.event), ['meta', 'progress', 'token', 'done']);
  // meta.refusal is the only thing that proves the gate fired: the prompt asks
  // the LLM for this same sentence, so the text alone proves nothing.
  assert.equal(sent[0].data.refusal, 'empty');
  assert.deepEqual(sent[0].data.retrievedChunks, []);
  assert.equal(sent[1].data.stage, 'generating');
  assert.equal(sent[2].data.delta, REFUSAL_TEXT_EN);
  assert.equal(sent[3].data.requestId, 'req-1');
});

test('emitRefusal carries the retrieved chunks and reason for a low_score refusal', async () => {
  const { sent, send } = collector();

  await emitRefusal(send, {
    requestId: 'req-2',
    question: '员工有多少人？',
    retrievedChunks: CHUNKS,
    reason: 'low_score',
  });

  assert.equal(sent[0].data.refusal, 'low_score');
  assert.deepEqual(sent[0].data.retrievedChunks, CHUNKS);
  assert.equal(sent[2].data.delta, REFUSAL_TEXT_ZH);
});

test('done is emitted only after the turn is persisted', async () => {
  const { sent, send } = collector();
  const order: string[] = [];

  await emitRefusal(send, {
    requestId: 'req-3',
    question: 'who?',
    retrievedChunks: [],
    reason: 'empty',
    onComplete: async (text) => {
      // Unlocking the UI on `done` must not race a regenerate against a pending
      // insert — same contract as streamLlmAnswer's onComplete.
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`persisted:${text}`);
      assert.deepEqual(sent.map((s) => s.event), ['meta', 'progress', 'token']);
    },
  });

  order.push('returned');
  assert.deepEqual(order, [`persisted:${REFUSAL_TEXT_EN}`, 'returned']);
  assert.equal(sent.at(-1)?.event, 'done');
});
