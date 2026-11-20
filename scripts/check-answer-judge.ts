/**
 * Default: recheck saved user-reported results locally, without model calls.
 * --live: send all five fixed inputs to the configured judge, one at a time.
 * JSON goes to stdout; the summary goes to stderr so results can be redirected.
 */
import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import {
  buildAnswerJudgementPrompt,
  parseAnswerJudgementResult,
  type AnswerJudgementResult,
} from '../lib/eval/judge';
import { generateAnswer } from '../lib/llm/chat';
import { DEFAULT_CHAT_MODEL_ID } from '../lib/llm/catalog';
import fixture from '../tests/fixtures/answer-judge-learning.json';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--live')) {
    throw new Error('用法：node --import tsx scripts/check-answer-judge.ts [--live]');
  }
  const live = args.includes('--live');
  if (live) config({ path: '.env.local', quiet: true });
  const modelId = process.env.EVAL_JUDGE_MODEL || DEFAULT_CHAT_MODEL_ID;

  const results = [];
  for (const item of fixture.cases) {
    let result: AnswerJudgementResult;
    let rawReply: string | null = null;
    let promptSha256: string | null = null;

    if (live) {
      // Only the evaluation input is sent; expected verdicts and saved replies
      // stay outside the prompt so the fixture does not give away the label.
      const prompt = buildAnswerJudgementPrompt(item.input);
      promptSha256 = createHash('sha256').update(prompt).digest('hex');
      try {
        rawReply = await generateAnswer(prompt, { modelId });
        result = parseAnswerJudgementResult(rawReply);
      } catch (error: unknown) {
        result = {
          verdict: 'unscored',
          reason: `评分调用失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      // These JSON objects were copied from the user's individual runs.
      // Re-parsing them does not constitute a new semantic model evaluation.
      result = parseAnswerJudgementResult(JSON.stringify(item.recordedResult));
    }

    results.push({
      id: item.id,
      label: item.label,
      input: item.input,
      expectedVerdict: item.expectedVerdict,
      result,
      matchesExpected: result.verdict === item.expectedVerdict,
      rawReply,
      promptSha256,
    });
  }

  const matched = results.filter(item => item.matchesExpected).length;
  const unscored = results.filter(item => item.result.verdict === 'unscored').length;
  const report = {
    mode: live ? 'live_model_run' : 'saved_result_recheck',
    checkedAt: new Date().toISOString(),
    fixtureVersion: fixture.schemaVersion,
    requestedModelId: live ? modelId : fixture.requestedModelId,
    source: live ? 'current_model_calls' : fixture.source,
    note: live
      ? '仅为这五条开发样例的新评分；requestedModelId 是请求的模型标识。'
      : '只复核保存的判定与当前解析函数，未调用模型；并非新的模型评分结果。',
    total: results.length,
    matched,
    unscored,
    cases: results,
  };

  console.log(JSON.stringify(report, null, 2));
  console.error(`${live ? '新模型评分' : '已保存结果复核'}：${matched}/${results.length} 与预期一致；未评分 ${unscored} 条。`);
  // An expected fail is a successful check. Only disagreements or unscored
  // cases fail the batch; unscored cases remain in the total.
  if (matched !== results.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
