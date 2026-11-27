import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeAnswer, parseAnswerJudgementResult } from './judge';

test('模型请求失败时返回 unscored', async (t) => {
  // 使用假密钥，并在测试结束后恢复。
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';

  t.after(() => {
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
  });

  // 临时替换网络请求，模拟失败，不访问真实模型。
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('模拟网络失败');
  });

  t.mock.method(console, 'error', () => {});

  const result = await judgeAnswer({
    question: '第二阶段预算是多少？',
    expectedAnswer: '文档未说明。',
    answer: '文档未说明。',
    chunks: [],
    outOfScope: true,
  });

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(result.verdict, 'unscored');
  assert.match(result.reason, /评分调用失败/);
});

test('评分回复缺少理由时返回 unscored', () => {
  const raw = '{"verdict":"pass"}';

  const result = parseAnswerJudgementResult(raw);

  assert.equal(result.verdict, 'unscored');
});