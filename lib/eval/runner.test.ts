import assert from 'node:assert/strict';
import { test } from 'node:test';

test('服务端拒答后，仍执行答案评分并保留结果', async (t) => {
  // 假配置用于满足模块检查；本测试不访问真实服务。
  const previousEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };

  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  process.env.OPENROUTER_API_KEY = 'test-key';

  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // 模拟评分模型返回 fail。
  const judgement = {
    verdict: 'fail',
    reason: '模拟评分：有答案却拒答。',
  };

  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      choices: [{
        message: { content: JSON.stringify(judgement) },
      }],
    }),
  );

  // 配置准备好之后，再加载 runner。
  const { runCase } = await import('./runner');
  const { closePool } = await import('../db/pg');
  t.after(closePool);

  const result = await runCase(
    {
      id: 'refusal-still-judged',
      question: '初始资金是多少信用点？',
      expectedAnswer: '4.2 亿信用点。',
      expectedKeywords: ['4.2 亿'],
      targetFileNames: ['demo.md'],
      category: 'numeric_fact',
      difficulty: 'easy',
    },
    {
      knowledgeBaseId: 'test-kb',
      judge: true,
      useRerank: true,
    },
    async () => [], // 模拟检索为空，触发拒答。
  );

  const selected = result.withRerank.result;

  assert.equal(selected.refused, true);
  assert.equal(selected.refusalReason, 'empty');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(selected.answerVerdict, 'fail');
  assert.equal(selected.answerReason, judgement.reason);
  assert.equal(result.withoutRerank.result.answerVerdict, 'unscored');
});