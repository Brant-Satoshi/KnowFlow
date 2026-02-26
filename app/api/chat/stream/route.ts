import { NextRequest } from 'next/server';

type SseEventName = 'meta' | 'token' | 'done' | 'error';
type ChunkMode = 'word' | 'char';

const encoder = new TextEncoder();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDebugOptions(body: unknown):
  | {
      enabled: boolean;
      delayMs: number;
      repeat: number;
      chunkBy: ChunkMode;
    }
  | undefined {
  if (!body || typeof body !== 'object' || !('debug' in body)) {
    return undefined;
  }

  const rawDebug = (body as { debug?: unknown }).debug;
  if (!rawDebug || typeof rawDebug !== 'object') {
    return undefined;
  }

  const debug = rawDebug as {
    delayMs?: unknown;
    repeat?: unknown;
    chunkBy?: unknown;
  };

  const delayMs =
    typeof debug.delayMs === 'number'
      ? clamp(Math.trunc(debug.delayMs), 10, 2000)
      : 120;
  const repeat =
    typeof debug.repeat === 'number'
      ? clamp(Math.trunc(debug.repeat), 1, 2000)
      : 200;
  const chunkBy: ChunkMode = debug.chunkBy === 'word' ? 'word' : 'char';

  return {
    enabled: true,
    delayMs,
    repeat,
    chunkBy,
  };
}

function buildDeltas(text: string, chunkBy: ChunkMode): string[] {
  if (chunkBy === 'char') {
    return text.split('');
  }

  const tokens = text.split(' ');
  return tokens.map((token, index) => (index === 0 ? token : ` ${token}`));
}

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
  const debug = parseDebugOptions(body);

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: SseEventName, data: unknown) => {
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };

      try {
        send('meta', { requestId });
        // TODO: Replace with actual LLM/RAG logic
        const baseReply = `Received: "${message}" - RAG/LLM not yet implemented`;
        const reply = debug?.enabled
          ? Array.from(
              { length: debug.repeat },
              (_, index) => `${index + 1}:${baseReply}`,
            ).join(' ')
          : baseReply;
        const deltas = buildDeltas(reply, debug?.chunkBy ?? 'word');

        for (let index = 0; index < deltas.length; index += 1) {
          if (request.signal.aborted) {
            break;
          }
          const delta = deltas[index];
          send('token', { delta });
          // Debug mode uses longer delay to make interruption easier to reproduce.
          const delayMs = debug?.enabled ? debug.delayMs : 10;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
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
