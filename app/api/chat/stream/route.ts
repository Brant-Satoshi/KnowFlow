import { NextRequest } from 'next/server';

type SseEventName = 'meta' | 'token' | 'done' | 'error';

const encoder = new TextEncoder();

function formatSse(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { requestId, ok: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }
  // Validate that body has a 'message' property of type string
  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? (body as { message?: unknown }).message
      : undefined;

  if (!message || typeof message !== 'string') {
    return Response.json(
      { requestId, ok: false, error: 'Message is required' },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: SseEventName, data: unknown) => {
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };

      try {
        send('meta', { requestId });
        // TODO: Replace with actual LLM/RAG logic
        const reply = `Received: "${message}" - RAG/LLM not yet implemented`;
        const tokens = reply.split(' ');

        for (let index = 0; index < tokens.length; index += 1) {
          if (request.signal.aborted) {
            break;
          }
          const delta = index === 0 ? tokens[index] : ` ${tokens[index]}`;
          send('token', { delta });
          // Slight delay to simulate streaming chunks.
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        if (!request.signal.aborted) {
          send('done', { requestId });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Stream error';
        send('error', { requestId, message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
