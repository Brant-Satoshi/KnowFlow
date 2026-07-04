import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import {
  deleteConversation,
  getConversationWithMessages,
  updateConversationModel,
  updateConversationTitle,
} from '@/lib/db/conversations';
import { isKnownChatModel } from '@/lib/llm/catalog';
import { isNotFoundOrForbiddenError, requireConversationAccess } from '@/lib/authz/access';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(
  'Failed to load conversation',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'conversation id');
    if (id instanceof Response) return id;

    try {
      await requireConversationAccess(user.id, id);

      const conversation = await getConversationWithMessages(id);
      if (!conversation) {
        return Response.json(
          error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
          { status: 404 }
        );
      }

      return Response.json(success({ conversation }));
    } catch (e) {
      if (isNotFoundOrForbiddenError(e)) {
        return Response.json(error(e.message, { code: 'CONVERSATION_NOT_FOUND' }), { status: 404 });
      }
      const message = e instanceof Error ? e.message : 'Failed to load conversation';
      return Response.json(error(message), { status: 500 });
    }
  },
);

export const PUT = withAuth(
  'Failed to update conversation',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'conversation id');
    if (id instanceof Response) return id;

    try {
      const body: unknown = await req.json();
      if (!body || typeof body !== 'object') {
        return Response.json(error('Invalid request body'), { status: 400 });
      }

      const { title, model } = body as { title?: unknown; model?: unknown };
      const hasTitle = title !== undefined;
      const hasModel = model !== undefined;
      if (!hasTitle && !hasModel) {
        return Response.json(
          error('Must provide title or model'),
          { status: 400 }
        );
      }

      if (hasTitle && (typeof title !== 'string' || !title.trim())) {
        return Response.json(
          error('title must be a non-empty string'),
          { status: 400 }
        );
      }

      let modelValue: string | null | undefined;
      if (hasModel) {
        if (model === null) {
          modelValue = null;
        } else if (typeof model === 'string' && isKnownChatModel(model)) {
          modelValue = model;
        } else {
          return Response.json(
            error('model must be a known chat model id or null'),
            { status: 400 }
          );
        }
      }

      await requireConversationAccess(user.id, id);

      let conversation;
      if (hasTitle) {
        conversation = await updateConversationTitle(id, (title as string).trim());
      }
      if (hasModel) {
        conversation = await updateConversationModel(id, modelValue as string | null);
      }

      if (!conversation) {
        return Response.json(
          error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
          { status: 404 }
        );
      }

      return Response.json(success({ conversation }));
    } catch (e) {
      if (isNotFoundOrForbiddenError(e)) {
        return Response.json(error(e.message, { code: 'CONVERSATION_NOT_FOUND' }), { status: 404 });
      }
      const message = e instanceof Error ? e.message : 'Failed to update conversation';
      return Response.json(error(message), { status: 500 });
    }
  },
);

export const DELETE = withAuth(
  'Failed to delete conversation',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'conversation id');
    if (id instanceof Response) return id;

    try {
      await requireConversationAccess(user.id, id);

      const deleted = await deleteConversation(id);
      if (!deleted) {
        return Response.json(
          error('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' }),
          { status: 404 }
        );
      }

      return Response.json(success({ deleted: true }));
    } catch (e) {
      if (isNotFoundOrForbiddenError(e)) {
        return Response.json(error(e.message, { code: 'CONVERSATION_NOT_FOUND' }), { status: 404 });
      }
      const message = e instanceof Error ? e.message : 'Failed to delete conversation';
      return Response.json(error(message), { status: 500 });
    }
  },
);
