import { searchChunks } from '@/lib/db/chunks';
import {
  appendMessage,
  DEFAULT_CONVERSATION_TITLE,
  getConversationById,
  listRecentMessages,
  touchConversation,
  updateConversationTitle,
} from '@/lib/db/conversations';
import {
  buildPrompt,
  formatSse,
  generateConversationTitle,
  streamLlmAnswer,
  type ChatHistoryMessage,
  type SseSend,
} from '@/lib/llm/chat';
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

function getStringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const fallbackId = crypto.randomUUID();
    return Response.json(
      { requestId: fallbackId, ok: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  // Prefer client-supplied requestId so it matches the assistant message id; fall back if absent.
  const clientRequestId = getStringField(body, 'requestId');
  const requestId = clientRequestId && isValidUuid(clientRequestId) ? clientRequestId : crypto.randomUUID();

  // Optional client-generated user message id. Lets regenerate target the right rows.
  const clientUserMessageId = getStringField(body, 'userMessageId');
  const userMessageId =
    clientUserMessageId && isValidUuid(clientUserMessageId) ? clientUserMessageId : undefined;

  const message = getStringField(body, 'message');
  if (!message || !message.trim()) {
    return Response.json(
      { requestId, ok: false, error: 'Message is required' },
      { status: 400 },
    );
  }

  const knowledgeBaseIdRaw =
    typeof body === 'object' && body !== null && 'knowledgeBaseId' in body
      ? (body as { knowledgeBaseId?: unknown }).knowledgeBaseId
      : undefined;

  if (knowledgeBaseIdRaw !== undefined && knowledgeBaseIdRaw !== null && typeof knowledgeBaseIdRaw !== 'string') {
    return Response.json(
      { requestId, ok: false, error: 'knowledgeBaseId must be a string' },
      { status: 400 },
    );
  }

  const knowledgeBaseId = typeof knowledgeBaseIdRaw === 'string' ? knowledgeBaseIdRaw : undefined;

  if (knowledgeBaseId && !isValidUuid(knowledgeBaseId)) {
    return Response.json(
      { requestId, ok: false, error: 'Invalid knowledgeBaseId' },
      { status: 400 },
    );
  }

  const conversationId = getStringField(body, 'conversationId');
  if (!conversationId || !isValidUuid(conversationId)) {
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

  if (knowledgeBaseId && conversation.knowledgeBaseId !== knowledgeBaseId) {
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

  await appendMessage(conversationId, 'user', message, undefined, userMessageId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send: SseSend = (event, data) => {
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };

      let titleTask: Promise<void> | undefined;
      if (conversation.title === DEFAULT_CONVERSATION_TITLE) {
        titleTask = (async () => {
          try {
            const title = await generateConversationTitle(message, request.signal);
            if (!title) return;
            const updated = await updateConversationTitle(conversationId, title);
            if (updated) {
              send('title', { requestId, conversationId, title: updated.title });
            }
          } catch (err) {
            console.error(`[${requestId}] title generation failed:`, err);
          }
        })();
      }

      try {
        send('progress', { requestId, stage: 'searching' });
        const queryEmbedding = await embedText(message, { signal: request.signal });
        const recalledChunks = await searchChunks(
          queryEmbedding,
          20,
          0.4,
          undefined,
          conversation.knowledgeBaseId,
        );
        send('progress', {
          requestId,
          stage: 'searched',
          recalledCount: recalledChunks.length,
        });

        const rerankWillRun = recalledChunks.length > 1;
        if (rerankWillRun) {
          send('progress', { requestId, stage: 'reranking' });
        }
        const rerankedChunks = await rerankChunks(message, recalledChunks, {
          signal: request.signal,
          topN: 8,
        });

        const finalChunks = rerankedChunks.slice(0, 5);
        send('progress', {
          requestId,
          stage: 'reranked',
          finalCount: finalChunks.length,
          rerankSkipped: !rerankWillRun,
        });

        const retrievedChunks: RetrievedChunk[] = finalChunks.map((c, i) => {
          const meta = c.meta ?? {};
          const rerankScore = meta._rerankScore;
          const distance = meta._distance;
          let score: number | undefined;
          let scoreType: RetrievedChunk['scoreType'];
          if (typeof rerankScore === 'number') {
            score = rerankScore;
            scoreType = 'rerank';
          } else if (typeof distance === 'number') {
            score = Math.max(0, 1 - distance);
            scoreType = 'vector';
          }
          return {
            index: i + 1,
            chunkId: c.id,
            fileId: c.fileId,
            fileName: c.fileName ?? c.fileId,
            page: meta.page,
            quote: c.text.slice(0, 300),
            score,
            scoreType,
          };
        });

        send('meta', { requestId, retrievedChunks });
        send('progress', { requestId, stage: 'generating' });

        const prompt = buildPrompt(message, finalChunks);
        await streamLlmAnswer(send, prompt, request.signal, requestId, {
          history,
          onComplete: async (fullText: string) => {
            if (fullText.length > 0) {
              await appendMessage(
                conversationId,
                'assistant',
                fullText,
                retrievedChunks,
                requestId,
              );
            }
            await touchConversation(conversationId);
          },
        });
      } catch (e) {
        console.error(`[${requestId}] chat error:`, e);
        send('error', {
          requestId,
          message: e instanceof Error ? e.message : 'Chat failed',
        });
      } finally {
        if (titleTask) await titleTask;
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
