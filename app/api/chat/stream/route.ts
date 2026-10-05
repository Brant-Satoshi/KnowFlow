import {
  appendMessage,
  DEFAULT_CONVERSATION_TITLE,
  listRecentMessages,
  touchConversation,
  updateConversationModel,
  updateConversationTitle,
} from '@/lib/db/conversations';
import { isKnownChatModel } from '@/lib/llm/catalog';
import {
  buildPrompt,
  formatSse,
  generateConversationTitle,
  streamLlmAnswer,
  type ChatHistoryMessage,
  type SseSend,
} from '@/lib/llm/chat';
import { classifyChatError } from '@/lib/llm/errors';
import { emitRefusal } from '@/lib/llm/refusal';
import { resolveRerankProvider } from '@/lib/models';
import { assessRetrieval } from '@/lib/rag/refusal-gate';
import { recallChunks, RETRIEVAL, selectFinalChunks } from '@/lib/rag/retrieve';
import { NextRequest } from 'next/server';
import { isValidUuid, parseRetrievalFilter } from '@/lib/validation';
import type { RetrievedChunk } from '@/lib/types';
import { requireUser } from '@/lib/auth/current-user';
import { isNotFoundOrForbiddenError, requireConversationAccess } from '@/lib/authz/access';

const MAX_HISTORY_MESSAGES = 8;

// Keep the connection visibly alive through proxies and let the client's idle
// watchdog (3× this interval) distinguish a slow stage from a dead connection.
const KEEPALIVE_INTERVAL_MS = 15_000;

// How long the stream waits after the answer finishes for the async title task
// to flush its `title` event before closing. Title generation starts at
// request-begin and is almost always done by the time the answer streams, so
// this cap only matters if title-gen outlasts the whole answer; past it we
// close anyway (the title task's own `streamOpen` guard drops the late event).
const TITLE_DRAIN_TIMEOUT_MS = 5_000;

/** Resolve when `p` settles or `ms` elapses, whichever comes first; no leaked timer. */
function settleOrTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

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
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

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

  const filterResult = parseRetrievalFilter((body as Record<string, unknown>).filter);
  if (!filterResult.ok) {
    return Response.json(
      { requestId, ok: false, error: filterResult.error },
      { status: 400 },
    );
  }
  const retrievalFilter = filterResult.filter;

  const conversationId = getStringField(body, 'conversationId');
  if (!conversationId || !isValidUuid(conversationId)) {
    return Response.json(
      { requestId, ok: false, error: 'Valid conversationId is required' },
      { status: 400 },
    );
  }

  let conversation;
  try {
    conversation = await requireConversationAccess(auth.id, conversationId);
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(
        { requestId, ok: false, error: e.message },
        { status: 404 },
      );
    }
    throw e;
  }

  if (knowledgeBaseId && conversation.knowledgeBaseId !== knowledgeBaseId) {
    return Response.json(
      { requestId, ok: false, error: 'Conversation does not belong to this knowledge base' },
      { status: 400 },
    );
  }

  // Resolve chat model: client choice wins if it's in the catalog, else conversation's saved
  // model, else server falls back to catalog default inside resolveChatProvider().
  const requestedModel = getStringField(body, 'model');
  const modelId =
    requestedModel && isKnownChatModel(requestedModel) ? requestedModel : conversation.model ?? undefined;

  // Persist on change so the picker can hydrate on reload.
  if (modelId && modelId !== conversation.model) {
    updateConversationModel(conversationId, modelId).catch(err => {
      console.error(`[${requestId}] failed to persist conversation model:`, err);
    });
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
      let streamOpen = true;
      const send: SseSend = (event, data) => {
        if (!streamOpen) return;
        controller.enqueue(encoder.encode(formatSse(event, data)));
      };

      // SSE comment lines: ignored by the parser, but they keep bytes flowing
      // during silent stages (embedding, rerank, LLM time-to-first-token).
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          // Client is gone; the in-flight work sees request.signal separately.
          clearInterval(keepalive);
        }
      }, KEEPALIVE_INTERVAL_MS);

      // First turn only: generate the title concurrently with retrieval + the
      // answer stream. Held in `titleTask` (not fire-and-forget) so the finally
      // block can drain its `title` event before closing the stream.
      let titleTask: Promise<void> | undefined;
      if (conversation.title === DEFAULT_CONVERSATION_TITLE) {
        titleTask = (async () => {
          try {
            const title = await generateConversationTitle(message, request.signal);
            if (!title) return;
            const updated = await updateConversationTitle(conversationId, title);
            if (updated && streamOpen) {
              send('title', { requestId, conversationId, title: updated.title });
            }
          } catch (err) {
            console.error(`[${requestId}] title generation failed:`, err);
          }
        })();
      }

      try {
        send('progress', { requestId, stage: 'searching' });
        const recalledChunks = await recallChunks(message, {
          knowledgeBaseId: conversation.knowledgeBaseId,
          filter: retrievalFilter,
          signal: request.signal,
        });
        send('progress', {
          requestId,
          stage: 'searched',
          recalledCount: recalledChunks.length,
        });

        const rerankWillRun = recalledChunks.length > 1;
        if (rerankWillRun) {
          send('progress', { requestId, stage: 'reranking' });
        }
        const finalChunks = await selectFinalChunks(
          message,
          recalledChunks,
          'auto',
          request.signal,
        );
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
          const keywordSim = meta._keywordSim;
          let score: number | undefined;
          let scoreType: RetrievedChunk['scoreType'];
          if (typeof rerankScore === 'number') {
            score = rerankScore;
            scoreType = 'rerank';
          } else if (typeof distance === 'number') {
            score = Math.max(0, 1 - distance);
            scoreType = 'vector';
          } else if (typeof keywordSim === 'number') {
            // Keyword-only chunk (no rerank, missed by the vector leg) — surfaced
            // by the hybrid keyword leg, so show its trigram similarity.
            score = keywordSim;
            scoreType = 'keyword';
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

        // Nothing worth answering from: say so, and never let the LLM improvise
        // over an empty (or irrelevant) context. `meta.refusal` records which
        // rule fired; `emitRefusal` streams the canned text as a normal turn, so
        // the client needs no special case.
        const refusal = assessRetrieval(message, finalChunks, {
          minRerankScore: RETRIEVAL.minRerankScore,
          rerankModel: resolveRerankProvider().model,
        });
        if (refusal) {
          console.log(
            `[${requestId}] refusal=${refusal} recalled=${recalledChunks.length} final=${finalChunks.length}`,
          );
          await emitRefusal(send, {
            requestId,
            question: message,
            retrievedChunks,
            reason: refusal,
            onComplete: async (text) => {
              await appendMessage(conversationId, 'assistant', text, retrievedChunks, requestId);
              await touchConversation(conversationId);
            },
          });
          return;
        }

        send('meta', { requestId, retrievedChunks });
        send('progress', { requestId, stage: 'generating' });

        const prompt = buildPrompt(message, finalChunks);
        await streamLlmAnswer(send, prompt, request.signal, requestId, {
          history,
          modelId,
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
        // `code` is what the client renders; `message` keeps the upstream detail
        // for this log line, which shares the requestId with the client's turn.
        const code = classifyChatError(e);
        console.error(`[${requestId}] chat error (${code}):`, e);
        send('error', {
          requestId,
          code,
          message: e instanceof Error ? e.message : 'Chat failed',
        });
      } finally {
        // Drain the async title task so its `title` event flushes while the
        // stream is still open. Without this, on a conversation's first turn the
        // title is generated and persisted but its SSE event is dropped (stream
        // already closed), leaving the sidebar on the default title until reload.
        // The client keeps reading past `done` precisely to receive it. Bounded
        // so a hung title-gen can never hold the stream open indefinitely.
        if (titleTask) {
          await settleOrTimeout(titleTask, TITLE_DRAIN_TIMEOUT_MS);
        }
        streamOpen = false;
        clearInterval(keepalive);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
