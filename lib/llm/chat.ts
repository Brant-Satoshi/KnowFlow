import { Chunk } from "../types";
import { isSummaryQuery } from '../validation';
import { resolveChatProvider } from '../models';
import { extractUpstreamMessage, openRouterFetch, readJsonSafe } from './openrouter';
import {
  buildConversationSummaryPrompt,
  buildQaPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
  formatChunks,
} from './prompts';

type ChatApiResponse = {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

export type SseEventName = 'meta' | 'token' | 'done' | 'error' | 'progress' | 'title';

export function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type SseSend = (event: SseEventName, data: unknown) => void;

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface StreamAnswerOptions {
  history?: ChatHistoryMessage[];
  extraMeta?: Record<string, unknown>;
  onComplete?: (fullText: string) => Promise<void> | void;
  modelId?: string;
}

export function buildPrompt(question: string, chunks: Chunk[]) {
  const numberedContext = formatChunks(chunks);

  if (isSummaryQuery(question)) {
    if (chunks.length === 0) {
      return buildConversationSummaryPrompt();
    }

    return buildSummaryPrompt(question, numberedContext);
  }

  return buildQaPrompt(question, numberedContext);
}

export interface StreamLlmAnswerOptions {
  history?: ChatHistoryMessage[];
  onComplete?: (fullText: string) => Promise<void> | void;
  modelId?: string;
}

/**
 * Drives a Chat Completions stream and forwards `token` / `done` / `error` events
 * via the supplied `send` callback. Does NOT emit `meta` — the caller owns the
 * outer stream and is responsible for `meta` ordering.
 */
export async function streamLlmAnswer(
  send: SseSend,
  prompt: string,
  signal: AbortSignal,
  requestId: string,
  options?: StreamLlmAnswerOptions,
): Promise<void> {
  const provider = resolveChatProvider(options?.modelId);
  const history = options?.history ?? [];
  const onComplete = options?.onComplete;

  const llmMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt },
  ];

  const response = await openRouterFetch(
    provider,
    { model: provider.model, stream: true, messages: llmMessages },
    signal,
  );

  if (!response.ok) {
    let errorData: unknown = null;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    const message = extractUpstreamMessage(errorData) ?? `LLM request failed: ${response.status}`;
    console.error(`[${requestId}] LLM upstream ${response.status}:`, errorData);
    send('error', { requestId, status: response.status, message, error: errorData });
    return;
  }

  const accumulated: string[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;
  let streamedOk = false;

  try {
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        streamDone = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6);

        if (jsonStr === '[DONE]') {
          streamDone = true;
          break;
        }

        try {
          const data = JSON.parse(jsonStr);
          const content = data.choices?.[0]?.delta?.content;

          if (content) {
            accumulated.push(content);
            // Forward upstream deltas as-is: pacing mirrors the real LLM stream
            // (the client batches renders per animation frame).
            send('token', { delta: content });
          }
        } catch { }
      }
    }
    streamedOk = true;
  } finally {
    if (onComplete) {
      try {
        await onComplete(accumulated.join(''));
      } catch (err) {
        console.error(`[${requestId}] onComplete failed:`, err);
      }
    }
    // `done` is the client's completion signal: emit it only after onComplete
    // has persisted the assistant turn, so unlocking the UI on `done` can't
    // race a regenerate against the pending insert.
    if (streamedOk) send('done', { requestId });
  }
}

/**
 * Backwards-compatible wrapper around streamLlmAnswer that returns a complete
 * SSE ReadableStream including the `meta` event. Kept for non-chat callers
 * (e.g. /eval) that don't need fine-grained progress signalling.
 */
export async function streamAnswer(
  prompt: string,
  signal: AbortSignal,
  requestId: string,
  options?: StreamAnswerOptions,
): Promise<ReadableStream<Uint8Array>> {
  const extraMeta = options?.extraMeta;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send: SseSend = (event, data) => {
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };
      send('meta', { requestId, ...extraMeta });
      try {
        await streamLlmAnswer(send, prompt, signal, requestId, {
          history: options?.history,
          onComplete: options?.onComplete,
          modelId: options?.modelId,
        });
      } catch (err) {
        send('error', {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });
}

export interface GenerateAnswerOptions {
  signal?: AbortSignal;
  modelId?: string;
}

export async function generateAnswer(
  prompt: string,
  options?: GenerateAnswerOptions,
): Promise<string> {
  const provider = resolveChatProvider(options?.modelId);
  const response = await openRouterFetch(
    provider,
    { model: provider.model, stream: false, messages: [{ role: 'user', content: prompt }] },
    options?.signal,
  );

  if (!response.ok) {
    const message = extractUpstreamMessage(await readJsonSafe(response));
    throw new Error(message ?? `LLM request failed: ${response.status}`);
  }

  const data = await response.json() as ChatApiResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');
  return content;
}

const TITLE_MAX_CHARS = 60;

export async function generateConversationTitle(
  userMessage: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const raw = await generateAnswer(buildTitlePrompt(userMessage), { signal });
  const cleaned = raw
    .trim()
    .split('\n')[0]
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/[。.!?！？]+$/, '')
    .trim()
    .slice(0, TITLE_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : null;
}
