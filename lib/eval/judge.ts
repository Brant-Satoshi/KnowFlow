/**
 * LLM-as-judge metrics for curated eval runs.
 *
 * Two post-hoc, read-only judgements over an already-produced answer:
 *   - faithfulness:     are the answer's claims grounded in the retrieved chunks?
 *   - answer relevance: does the answer actually address the question?
 *
 * Both call the existing non-streaming `generateAnswer` against a cheap judge
 * model and parse a single 0–1 score. Any failure (blank answer, network error,
 * unparseable response) resolves to `null` rather than failing the whole run —
 * the run aggregates over non-null scores only.
 */
import type { Chunk } from '@/lib/types';
import { generateAnswer } from '@/lib/llm/chat';
import { DEFAULT_CHAT_MODEL_ID } from '@/lib/llm/catalog';

/** Cheap, deterministic-ish model for grading. Overridable, no new required env. */
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || DEFAULT_CHAT_MODEL_ID;

/** Extract the first 0–1 float from a judge reply (JSON `{"score":..}` or bare number). */
function parseScore(raw: string): number | null {
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function numberedContext(chunks: Chunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join('\n\n');
}

async function score(prompt: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const reply = await generateAnswer(prompt, { modelId: JUDGE_MODEL, signal });
    return parseScore(reply);
  } catch (e) {
    console.error('[eval/judge] scoring error:', e);
    return null;
  }
}

/**
 * Faithfulness: fraction of the answer's claims supported by the retrieved
 * context. Returns null for a blank answer or when there is no context to
 * ground against.
 */
export async function judgeFaithfulness(
  answer: string,
  chunks: Chunk[],
  signal?: AbortSignal,
): Promise<number | null> {
  if (!answer.trim() || chunks.length === 0) return null;
  const prompt = `You are a strict RAG evaluator scoring FAITHFULNESS: how well the ANSWER is grounded in the provided CONTEXT.

Score 1.0 only if every factual claim in the answer is directly supported by the context. Lower the score for each claim that is unsupported, contradicted, or fabricated. Ignore style, fluency, and whether the answer is complete.

CONTEXT:
${numberedContext(chunks)}

ANSWER:
${answer}

Respond with ONLY this JSON, no prose: {"score": <number between 0 and 1>}`;
  return score(prompt, signal);
}

/**
 * Answer relevance: how directly the answer addresses the question, independent
 * of factual correctness. Returns null for a blank answer.
 */
export async function judgeAnswerRelevance(
  question: string,
  answer: string,
  signal?: AbortSignal,
): Promise<number | null> {
  if (!answer.trim()) return null;
  const prompt = `You are a strict RAG evaluator scoring ANSWER RELEVANCE: how directly the ANSWER addresses the QUESTION.

Score 1.0 if the answer fully and directly responds to the question. Lower the score for evasive, partial, off-topic, or padded answers. Judge only relevance to the question — not factual accuracy.

QUESTION:
${question}

ANSWER:
${answer}

Respond with ONLY this JSON, no prose: {"score": <number between 0 and 1>}`;
  return score(prompt, signal);
}
