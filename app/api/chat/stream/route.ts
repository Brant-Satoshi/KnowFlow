import { searchChunks } from '@/lib/db/chunks';
import { buildPrompt, streamAnswer } from '@/lib/llm/chat';
import { embedText } from '@/lib/rag/embedings';
import { NextRequest } from 'next/server';

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

  const queryEmbedding = await embedText(message);
  const chunks = await searchChunks(queryEmbedding, 5, 0.4);

  const prompt = buildPrompt(message, chunks);
  
  const stream = await streamAnswer(prompt, request.signal, requestId, message);

  return new Response(stream, { headers: sseHeaders() });
}
