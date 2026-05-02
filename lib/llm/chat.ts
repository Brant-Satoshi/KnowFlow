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

type SseEventName = 'meta' | 'token' | 'done' | 'error';

function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

export function buildPrompt(question: string, chunks: Chunk[]) {
  if (isSummaryQuery(question) && chunks.length === 0) {
    return `Please summarize the conversation so far.`;
  }
  const numbered = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
  if (isSummaryQuery(question)) {
    return `You are a helpful assistant.

Summarize the following content into key points.

Rules:
- Be concise
- Use bullet points
- Do NOT say "not found"
- When referencing specific content, cite by number like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers

Content:
${numbered}`;
  }
  return `You are a helpful assistant.

Answer the user's question using ONLY the provided context.

If the answer cannot be found in the context, say: "I couldn't find relevant information in the knowledge base."

Rules:
- Cite sources inline using bracket numbers like [1] or [1][2]
- Do NOT write [Source: filename], only use bracket numbers

Context:
${numbered}

Question:
${question}`;
}

export async function streamAnswer(
  prompt: string,
  signal: AbortSignal,
  requestId: string,
  options?: StreamAnswerOptions,
) {
  const provider = resolveChatProvider();
  const history = options?.history ?? [];
  const extraMeta = options?.extraMeta;
  const onComplete = options?.onComplete;

  const llmMessages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: prompt },
  ];

  const response = await fetch(provider.url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: llmMessages,
    }),
  });

  // Check for HTTP errors before processing the stream
  if (!response.ok) {
    const encoder = new TextEncoder();
    let errorData: unknown = null;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    const errorStream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode(formatSse('meta', { requestId, ...extraMeta })));
        controller.enqueue(encoder.encode(formatSse('error', { requestId, status: response.status, error: errorData })));
        controller.close();
      },
    });
    return errorStream;
  }
  const encoder = new TextEncoder();

  const accumulated: string[] = [];
  let completeFired = false;
  const fireComplete = async () => {
    if (completeFired) return;
    completeFired = true;
    if (!onComplete) return;
    try {
      await onComplete(accumulated.join(''));
    } catch (err) {
      console.error(`[${requestId}] onComplete failed:`, err);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      const send = (event: SseEventName, data: unknown) => {
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };

      send('meta', { requestId, ...extraMeta });

      let buffer = '';
      let streamDone = false;
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
                await new Promise(r => setTimeout(r, 10));
              }
            }
          } catch { }
        }
      }
      send('done', { requestId });
      controller.close();
      await fireComplete();
    },
    cancel: async () => {
      await fireComplete();
    },
  });
  return stream;
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
