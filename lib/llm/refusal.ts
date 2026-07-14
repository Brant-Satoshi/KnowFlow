import type { RefusalReason, RetrievedChunk } from '../types';
import type { SseSend } from './chat';

/**
 * The refusal answer, in both directions it can be produced:
 *
 *  - the LLM says it, because `buildQaPrompt` instructs it to when the context
 *    doesn't contain the answer;
 *  - the server says it *for* the LLM, because the retrieval gate decided there
 *    was nothing worth answering from (see lib/rag/refusal-gate.ts) and skipped
 *    the call entirely.
 *
 * Both paths must emit the exact same string: the client suppresses the
 * "no citations" warning on it (`isRefusalText`), and a divergence would make a
 * prompt-level refusal look like an uncited hallucination.
 */
export const REFUSAL_TEXT_ZH = '我没有在知识库中找到相关信息。';
export const REFUSAL_TEXT_EN = "I couldn't find relevant information in the knowledge base.";

/** Answer in the language of the question; anything non-CJK falls back to English. */
export function isChineseQuestion(question: string): boolean {
  return /[一-鿿]/.test(question);
}

export function refusalTextFor(question: string): string {
  return isChineseQuestion(question) ? REFUSAL_TEXT_ZH : REFUSAL_TEXT_EN;
}

export function isRefusalText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === REFUSAL_TEXT_ZH || trimmed === REFUSAL_TEXT_EN;
}

export interface EmitRefusalArgs {
  requestId: string;
  question: string;
  retrievedChunks: RetrievedChunk[];
  reason: RefusalReason;
  onComplete?: (text: string) => Promise<void> | void;
}

/**
 * Stream a refusal as if it were an ordinary (very short) answer, so the client
 * needs no special case: `meta` → `progress` → one `token` → `done`.
 *
 * `meta.refusal` carries the machine-readable reason. It is what proves the gate
 * fired: the canned text alone can't, since the prompt asks the LLM for the same
 * sentence when it finds nothing.
 *
 * `done` is emitted only after `onComplete` has persisted the turn — same
 * contract as `streamLlmAnswer`, so unlocking the UI on `done` can't race a
 * regenerate against a pending insert.
 */
export async function emitRefusal(send: SseSend, args: EmitRefusalArgs): Promise<string> {
  const text = refusalTextFor(args.question);

  send('meta', {
    requestId: args.requestId,
    retrievedChunks: args.retrievedChunks,
    refusal: args.reason,
  });
  send('progress', { requestId: args.requestId, stage: 'generating' });
  send('token', { delta: text });

  await args.onComplete?.(text);

  send('done', { requestId: args.requestId });
  return text;
}
