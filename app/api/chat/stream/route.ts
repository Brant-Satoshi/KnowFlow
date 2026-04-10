import { searchChunks } from '@/lib/db/chunks';
import { buildPrompt, streamAnswer } from '@/lib/llm/chat';
import { embedText } from '@/lib/rag/embedings';
import { NextRequest } from 'next/server';
import { isValidUuid } from '@/lib/validation';
import { rerankChunks } from '@/lib/rag/rerank';

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

  if (!message || typeof message !== 'string' || !message.trim()) {
    return Response.json(
      { requestId, ok: false, error: 'Message is required' },
      { status: 400 },
    );
  }

  const knowledgeBaseId =
    typeof body === 'object' && body !== null && 'knowledgeBaseId' in body
      ? (body as { knowledgeBaseId?: unknown }).knowledgeBaseId
      : undefined;

  if (knowledgeBaseId !== undefined && knowledgeBaseId !== null && typeof knowledgeBaseId !== 'string') {
    return Response.json(
      { requestId, ok: false, error: 'knowledgeBaseId must be a string' },
      { status: 400 },
    );
  }

  if (typeof knowledgeBaseId === 'string' && !isValidUuid(knowledgeBaseId)) {
    return Response.json(
      { requestId, ok: false, error: 'Invalid knowledgeBaseId' },
      { status: 400 },
    );
  }

  try {
    const queryEmbedding = await embedText(message, { signal: request.signal });
    const recalledChunks = await searchChunks(
      queryEmbedding,
      20,
      0.4,
      undefined,
      typeof knowledgeBaseId === 'string' ? knowledgeBaseId : undefined
    );

    const rerankedChunks = await rerankChunks(message, recalledChunks, {
      signal: request.signal,
      topN: 8,
    });

    const finalChunks = rerankedChunks.slice(0, 5);

    const prompt = buildPrompt(message, finalChunks);
    const stream = await streamAnswer(prompt, request.signal, requestId);

    return new Response(stream, { headers: sseHeaders() });
  } catch (e) {
    console.error(`[${requestId}] chat error:`, e);
    return Response.json(
      { requestId, ok: false, error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 },
    );
  }
}
