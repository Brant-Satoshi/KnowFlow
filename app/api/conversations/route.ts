import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import {
  createConversation,
  listConversations,
} from '@/lib/db/conversations';
import { getKnowledgeBaseById } from '@/lib/db/knowledge-bases';
import { isValidUuid } from '@/lib/validation';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    if (!knowledgeBaseId || !isValidUuid(knowledgeBaseId)) {
      return Response.json(
        error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
        { status: 400 }
      );
    }

    const conversations = await listConversations(knowledgeBaseId);
    return Response.json(success({ conversations }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list conversations';
    return Response.json(error(message), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return Response.json(error('Invalid request body'), { status: 400 });
    }

    const { knowledgeBaseId, title } = body as {
      knowledgeBaseId?: unknown;
      title?: unknown;
    };

    if (typeof knowledgeBaseId !== 'string' || !isValidUuid(knowledgeBaseId)) {
      return Response.json(
        error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
        { status: 400 }
      );
    }

    const kb = await getKnowledgeBaseById(knowledgeBaseId);
    if (!kb) {
      return Response.json(
        error('Knowledge base not found', { code: 'KB_NOT_FOUND' }),
        { status: 404 }
      );
    }

    if (title !== undefined && typeof title !== 'string') {
      return Response.json(error('title must be a string'), { status: 400 });
    }

    const conversation = await createConversation(
      knowledgeBaseId,
      typeof title === 'string' ? title : undefined
    );

    return Response.json(success({ conversation }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create conversation';
    return Response.json(error(message), { status: 500 });
  }
}
