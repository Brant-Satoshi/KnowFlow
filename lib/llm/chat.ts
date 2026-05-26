import { Chunk } from "../types";
import { isSummaryQuery } from '../validation';

type ChatApiResponse = {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

type ChatProviderConfig = {
  url: string;
  apiKey: string;
  model: string;
};

const CHAT_PROVIDERS: Record<string, () => ChatProviderConfig> = {
  minimax: () => ({
    url: 'https://api.minimax.chat/v1/chat/completions',
    apiKey: process.env.MINIMAX_API_KEY ?? '',
    model: process.env.MINIMAX_CHAT_MODEL ?? 'abab6.5-chat',
  }),
  openrouter: () => ({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.OPENROUTER_CHAT_MODEL ?? 'openrouter/auto',
  }),
};

// Fallback order when CHAT_PROVIDER is not set
const CHAT_PROVIDER_PRIORITY = ['minimax', 'openrouter'];

const CHAT_PROVIDER_API_KEYS: Record<string, string | undefined> = {
  minimax: process.env.MINIMAX_API_KEY,
  openrouter: process.env.OPENROUTER_API_KEY,
};

function resolveChatProvider(): ChatProviderConfig {
  const name = process.env.CHAT_PROVIDER ?? CHAT_PROVIDER_PRIORITY.find(p => CHAT_PROVIDER_API_KEYS[p]);
  const factory = name ? CHAT_PROVIDERS[name] : undefined;
  if (!factory) throw new Error(`No chat provider configured. Set CHAT_PROVIDER or provide an API key.`);
  return factory();
}

export type SseEventName = 'meta' | 'token' | 'done' | 'error' | 'progress' | 'title';

export function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type SseSend = (event: SseEventName, data: unknown) => void;

function splitText(text: string) {
  return text.split(/(\s+)/);
}

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface StreamAnswerOptions {
  history?: ChatHistoryMessage[];
  extraMeta?: Record<string, unknown>;
  onComplete?: (fullText: string) => Promise<void> | void;
}

function formatChunks(chunks: Chunk[]) {
  return chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
}

function buildSummaryPrompt(numberedContext: string) {
  return `You are a helpful assistant.

Summarize the following context into key points.

Rules:
- Be concise
- Use bullet points
- Do NOT say "not found"
- When referencing specific content, cite by number like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers

Context:
${numberedContext}`;
}

function buildQaPrompt(question: string, numberedContext: string) {
   const isChinese = /[\u4e00-\u9fa5]/.test(question);
   const fallback = isChinese
    ? '我没有在知识库中找到相关信息。'
    : "I couldn't find relevant information in the knowledge base.";
  return `You are a helpful assistant.

Answer the user's question using ONLY the provided context.

If the answer cannot be found in the context, say exactly:
"${fallback}"

Rules:
- Cite sources inline using bracket numbers like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers
- Do NOT use outside knowledge
- Do NOT cite content that does not support the answer

Context:
${numberedContext}

Question:
${question}`;
}

export function buildPrompt(question: string, chunks: Chunk[]) {
  const numberedContext = formatChunks(chunks);

  if (isSummaryQuery(question)) {
    if (chunks.length === 0) {
      return `You are a helpful assistant.

Summarize the conversation so far based on the previous messages.

Rules:
- Be concise
- Use bullet points
- Do NOT invent details`;
    }

    return buildSummaryPrompt(numberedContext);
  }

  return buildQaPrompt(question, numberedContext);
}

export interface StreamLlmAnswerOptions {
  history?: ChatHistoryMessage[];
  onComplete?: (fullText: string) => Promise<void> | void;
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
  const provider = resolveChatProvider();
  const history = options?.history ?? [];
  const onComplete = options?.onComplete;

  const llmMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt },
  ];

  const response = await fetch(provider.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: llmMessages,
    }),
  });

  if (!response.ok) {
    let errorData: unknown = null;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    send('error', { requestId, status: response.status, error: errorData });
    return;
  }

  const accumulated: string[] = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;

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
            const chunks = splitText(content);

            for (const chunk of chunks) {
              send('token', { delta: chunk });
              await new Promise((r) => setTimeout(r, 10));
            }
          }
        } catch { }
      }
    }
    send('done', { requestId });
  } finally {
    if (onComplete) {
      try {
        await onComplete(accumulated.join(''));
      } catch (err) {
        console.error(`[${requestId}] onComplete failed:`, err);
      }
    }
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

export async function generateAnswer(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const provider = resolveChatProvider();
  const response = await fetch(provider.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    let errMsg = `LLM request failed: ${response.status}`;
    try {
      const errData = await response.json() as ChatApiResponse;
      if (errData.error?.message) errMsg = errData.error.message;
    } catch { }
    throw new Error(errMsg);
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
  const prompt = `You write concise chat conversation titles. Given the user's opening message below, output a title of 3-7 words that captures the main topic.

Rules:
- Output ONLY the title text. No quotes, no preamble, no trailing punctuation.
- Use the same language as the user's message (English if English, Chinese if Chinese).
- Be specific and informative, not generic.

User message:
${userMessage}

Title:`;

  const raw = await generateAnswer(prompt, signal);
  const cleaned = raw
    .trim()
    .split('\n')[0]
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/[。.!?！？]+$/, '')
    .trim()
    .slice(0, TITLE_MAX_CHARS);
  return cleaned.length > 0 ? cleaned : null;
}
