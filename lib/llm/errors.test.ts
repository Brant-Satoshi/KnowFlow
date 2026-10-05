import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyChatError,
  classifyUpstreamStatus,
  EmbeddingError,
  isChatErrorCode,
} from './errors';

test('upstream statuses map to the code the user sees', () => {
  assert.equal(classifyUpstreamStatus(429), 'rate_limited');
  assert.equal(classifyUpstreamStatus(401), 'llm_auth');
  assert.equal(classifyUpstreamStatus(403), 'llm_auth');
  assert.equal(classifyUpstreamStatus(408), 'timeout');
  assert.equal(classifyUpstreamStatus(504), 'timeout');
  assert.equal(classifyUpstreamStatus(500), 'llm_unavailable');
  assert.equal(classifyUpstreamStatus(502), 'llm_unavailable');
  assert.equal(classifyUpstreamStatus(503), 'llm_unavailable');
  assert.equal(classifyUpstreamStatus(400), 'llm_error');
  assert.equal(classifyUpstreamStatus(404), 'llm_error');
});

test('a deadline abort is a timeout, not a generic failure', () => {
  assert.equal(classifyChatError(new DOMException('stalled', 'TimeoutError')), 'timeout');
});

test('a user pressing stop is not reported as a timeout', () => {
  // It never reaches a message either — the client is already gone — but it must
  // not masquerade as the provider having gone silent.
  assert.notEqual(classifyChatError(new DOMException('aborted', 'AbortError')), 'timeout');
});

test('embedding failures separate "retry" from "call an operator"', () => {
  assert.equal(classifyChatError(new EmbeddingError('embedding failed: 500')), 'embedding_failed');
  assert.equal(
    classifyChatError(new EmbeddingError('dimensions do not match schema', 'config')),
    'service_config',
  );
});

test('anything else is a generic LLM error', () => {
  assert.equal(classifyChatError(new Error('boom')), 'llm_error');
  assert.equal(classifyChatError('boom'), 'llm_error');
  assert.equal(classifyChatError(undefined), 'llm_error');
});

test('isChatErrorCode rejects anything that is not a known code', () => {
  assert.equal(isChatErrorCode('rate_limited'), true);
  assert.equal(isChatErrorCode('timeout'), true);
  assert.equal(isChatErrorCode('toString'), false);
  assert.equal(isChatErrorCode('__proto__'), false);
  assert.equal(isChatErrorCode('not_a_code'), false);
  assert.equal(isChatErrorCode(42), false);
  assert.equal(isChatErrorCode(null), false);
});
