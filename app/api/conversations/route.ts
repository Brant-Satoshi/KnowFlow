import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import {
  createConversation,
  listConversations,
} from '@/lib/db/conversations';
import { isValidUuid } from '@/lib/validation';
import { isKnownChatModel } from '@/lib/llm/catalog';
import { isNotFoundOrForbiddenError, requireKnowledgeBaseAccess } from '@/lib/authz/access';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    if (!knowledgeBaseId || !isValidUuid(knowledgeBaseId)) {
      return Response.json(
        error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
        { status: 400 }
      );
    }

    await requireKnowledgeBaseAccess(auth.id, knowledgeBaseId);

    const conversations = await listConversations(knowledgeBaseId);
    return Response.json(success({ conversations }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to list conversations';
    return Response.json(error(message), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return Response.json(error('Invalid request body'), { status: 400 });
    }

    const { knowledgeBaseId, title, model } = body as {
      knowledgeBaseId?: unknown;
      title?: unknown;
      model?: unknown;
    };

    if (typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
      return Response.json(
        error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
        { status: 400 }
      );
    }

    await requireKnowledgeBaseAccess(auth.id, knowledgeBaseId);

    if (title !== undefined && typeof title !== 'string') {
      return Response.json(error('title must be a string'), { status: 400 });
    }

    const resolvedModel =
      typeof model === 'string' && isKnownChatModel(model) ? model : null;

    const conversation = await createConversation(
      knowledgeBaseId,
      typeof title === 'string' ? title : undefined,
      resolvedModel,
    );

    return Response.json(success({ conversation }), { status: 201 });
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message, { code: 'KB_NOT_FOUND' }), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to create conversation';
    return Response.json(error(message), { status: 500 });
  }
}
