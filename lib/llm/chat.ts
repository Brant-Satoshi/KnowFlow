import { Chunk } from "../types";

type SseEventName = 'meta' | 'token' | 'done' | 'error';

function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildPrompt(question: string, chunks: Chunk[]) {
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join('\n\n');

  return `
        You are a helpful assistant.

        Answer the user's question using ONLY the provided context.

        If the answer cannot be found in the context, say:
        "I couldn't find relevant information in the knowledge base."

        Context:
        ${context}

        Question:
        ${question}
        `;
}

export async function streamAnswer(prompt: string, signal: AbortSignal, requestId: string) {
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
        controller.enqueue(encoder.encode(formatSse('meta', { requestId })));
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

      send('meta', { requestId });

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
              send('token', { delta: content });
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