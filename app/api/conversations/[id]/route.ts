import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import {
  deleteConversation,
  getConversationWithMessages,
  updateConversationTitle,
} from '@/lib/db/conversations';
import { isValidUuid } from '@/lib/validation';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid conversation ID', { code: 'INVALID_CONVERSATION_ID' }),
        { status: 400 }
      );
    }

    const conversation = await getConversationWithMessages(id);
    if (!conversation) {
      return Response.json(
        error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
        { status: 404 }
      );
    }

    return Response.json(success({ conversation }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load conversation';
    return Response.json(error(message), { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid conversation ID', { code: 'INVALID_CONVERSATION_ID' }),
        { status: 400 }
      );
    }

    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return Response.json(error('Invalid request body'), { status: 400 });
    }

    const { title } = body as { title?: unknown };
    if (typeof title !== 'string' || !title.trim()) {
      return Response.json(
        error('title must be a non-empty string'),
        { status: 400 }
      );
    }

    const conversation = await updateConversationTitle(id, title.trim());
    if (!conversation) {
      return Response.json(
        error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
        { status: 404 }
      );
    }

    return Response.json(success({ conversation }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to rename conversation';
    return Response.json(error(message), { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid conversation ID', { code: 'INVALID_CONVERSATION_ID' }),
        { status: 400 }
      );
    }

    const deleted = await deleteConversation(id);
    if (!deleted) {
      return Response.json(
        error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
        { status: 404 }
      );
    }

    return Response.json(success({ deleted: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete conversation';
    return Response.json(error(message), { status: 500 });
  }
}
