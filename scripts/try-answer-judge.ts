import { buildAnswerJudgementPrompt, parseAnswerJudgementResult } from '../lib/eval/judge';
import { config } from 'dotenv';
import { generateAnswer } from '../lib/llm/chat';
import { DEFAULT_CHAT_MODEL_ID } from '../lib/llm/catalog';

config({ path: '.env.local', quiet: true });
const prompt = buildAnswerJudgementPrompt({
  question: '奥林匹斯项目运营哪些轨道气象站？',
  expectedAnswer: '三座气象站：赫利俄斯、维斯塔和代达罗斯。',
  answer: '项目运营赫利俄斯气象站。',
  outOfScope: false,
  chunks: [
    {
      id: 'demo-chunk',
      fileId: 'demo-file',
      idx: 0,
      text: '项目运营三座轨道气象站：赫利俄斯、维斯塔和代达罗斯。',
      meta: {},
    },
  ],
});

async function main() {
    const raw = await generateAnswer(prompt, {
        modelId: process.env.EVAL_JUDGE_MODEL || DEFAULT_CHAT_MODEL_ID,
    });

    const result = parseAnswerJudgementResult(raw);

    console.log('原始回复：', raw);
    console.log('判定：', result.verdict);
    console.log('理由：', result.reason);
}

main().catch((error: unknown) => {
    console.error(
        '评分调用失败：',
        error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
});