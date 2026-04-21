import { Chunk } from "../types";
import { isSummaryQuery } from '../validation'

type SseEventName = 'meta' | 'token' | 'done' | 'error';

function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function splitText(text: string) {
  return text.split(/(\s+)/);
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
  extraMeta?: Record<string, unknown>,
) {
  const response = await fetch(
    "https://api.minimax.chat/v1/text/chatcompletion_v2",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "abab6.5-chat",
        stream: true,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    }
  );

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

            // if (content.length < 10) → 直接发
            // if (content.length > 50) → 拆词
            // if (content.length > 100) → 拆字符
            if (content) {
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
    },
  });
  return stream;
}