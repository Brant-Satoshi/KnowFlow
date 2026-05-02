import { searchChunks } from '@/lib/db/chunks';
import {
  appendMessage,
  getConversationById,
  listRecentMessages,
  touchConversation,
} from '@/lib/db/conversations';
import { buildPrompt, streamAnswer, type ChatHistoryMessage } from '@/lib/llm/chat';
import { embedText } from '@/lib/rag/embeddings';
import { NextRequest } from 'next/server';
import { isValidUuid } from '@/lib/validation';
import { rerankChunks } from '@/lib/rag/rerank';
import type { RetrievedChunk } from '@/lib/types';

const MAX_HISTORY_MESSAGES = 8;

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

  const conversationId =
    typeof body === 'object' && body !== null && 'conversationId' in body
      ? (body as { conversationId?: unknown }).conversationId
      : undefined;

  if (typeof conversationId !== 'string' || !isValidUuid(conversationId)) {
    return Response.json(
      { requestId, ok: false, error: 'Valid conversationId is required' },
      { status: 400 },
    );
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return Response.json(
      { requestId, ok: false, error: 'Conversation not found' },
      { status: 404 },
    );
  }

  if (
    typeof knowledgeBaseId === 'string' &&
    conversation.knowledgeBaseId !== knowledgeBaseId
  ) {
    return Response.json(
      { requestId, ok: false, error: 'Conversation does not belong to this knowledge base' },
      { status: 400 },
    );
  }

  // Fetch history BEFORE persisting the new user message so we send only prior turns.
  const recentMessages = await listRecentMessages(conversationId, MAX_HISTORY_MESSAGES);
  const history: ChatHistoryMessage[] = recentMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  await appendMessage(conversationId, 'user', message);

  try {
    const queryEmbedding = await embedText(message, { signal: request.signal });
    const recalledChunks = await searchChunks(
      queryEmbedding,
      20,
      0.4,
      undefined,
      conversation.knowledgeBaseId,
    );

    const rerankedChunks = await rerankChunks(message, recalledChunks, {
      signal: request.signal,
      topN: 8,
    });

    const finalChunks = rerankedChunks.slice(0, 5);

    const retrievedChunks: RetrievedChunk[] = finalChunks.map((c, i) => ({
      index: i + 1,
      chunkId: c.id,
      fileId: c.fileId,
      fileName: c.fileName ?? c.fileId,
      page: c.meta.page,
      quote: c.text.slice(0, 300),
    }));

    const prompt = buildPrompt(message, finalChunks);
    const stream = await streamAnswer(prompt, request.signal, requestId, {
      history,
      extraMeta: { retrievedChunks },
      onComplete: async (fullText) => {
        if (fullText.length > 0) {
          await appendMessage(conversationId, 'assistant', fullText, retrievedChunks);
        }
        await touchConversation(conversationId);
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (e) {
    console.error(`[${requestId}] chat error:`, e);
    return Response.json(
      { requestId, ok: false, error: e instanceof Error ? e.message : 'Chat failed' },
      { status: 500 },
    );
  }
}
