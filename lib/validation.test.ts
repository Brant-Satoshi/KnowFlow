import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isConversationSummaryQuery, isSummaryQuery } from './validation';

// A conversation recap is the only query allowed to reach the LLM with zero
// retrieved chunks. Anything that names a topic must stay subject to the refusal
// gate, or "summarize what the docs say about X" quietly becomes a recap of the
// chat when the KB has nothing on X.

test('a bare summary request is a conversation recap', () => {
  for (const q of [
    '总结一下',
    '总结',
    'summarize',
    'Summarize.',
    'Give me a summary',
    'Can you summarize this?',
    '请帮我总结一下',
  ]) {
    assert.equal(isConversationSummaryQuery(q), true, q);
  }
});

test('an explicit reference to the conversation is a recap', () => {
  for (const q of [
    'summarize this conversation',
    'Summarize the discussion so far',
    '总结一下我们刚才聊的',
    '概括一下以上对话',
  ]) {
    assert.equal(isConversationSummaryQuery(q), true, q);
  }
});

test('a topical summary is NOT a conversation recap', () => {
  for (const q of [
    'Summarize information about Olympus',
    'Summarize the report',
    'Write a summary of the budget section',
    '总结一下知识库里关于奥林匹斯的内容',
    '概括这份文档的要点',
  ]) {
    assert.equal(isConversationSummaryQuery(q), false, q);
  }
});

test('a question with no summary keyword is never a recap', () => {
  assert.equal(isConversationSummaryQuery('who is the lead researcher?'), false);
  assert.equal(isConversationSummaryQuery('首席研究员是谁？'), false);
});

test('isSummaryQuery stays loose — it only picks the prompt when chunks exist', () => {
  assert.equal(isSummaryQuery('Summarize information about Olympus'), true);
  assert.equal(isSummaryQuery('总结一下'), true);
  assert.equal(isSummaryQuery('who is the lead researcher?'), false);
});
