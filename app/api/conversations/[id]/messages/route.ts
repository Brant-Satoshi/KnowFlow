import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { deleteMessages } from '@/lib/db/conversations';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireConversationAccess } from '@/lib/authz/access';

export const DELETE = withAuth(
  'Failed to delete messages',
  async (req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'conversation id');
    if (id instanceof Response) return id;

    try {
      const body: unknown = await req.json().catch(() => null);
      if (!body || typeof body !== 'object' || !('messageIds' in body)) {
        return Response.json(error('messageIds is required'), { status: 400 });
      }

      const raw = (body as { messageIds: unknown }).messageIds;
      if (!Array.isArray(raw) || raw.length === 0) {
        return Response.json(error('messageIds must be a non-empty array'), { status: 400 });
      }

      const messageIds = raw.filter((v): v is string => typeof v === 'string' && isValidUuid(v));
      if (messageIds.length !== raw.length) {
        return Response.json(error('messageIds contains invalid UUIDs'), { status: 400 });
      }

      await requireConversationAccess(user.id, id);

      const deleted = await deleteMessages(id, messageIds);
      return Response.json(success({ deleted }));
    } catch (e) {
      if (isNotFoundOrForbiddenError(e)) {
        return Response.json(error(e.message, { code: 'CONVERSATION_NOT_FOUND' }), { status: 404 });
      }
      const message = e instanceof Error ? e.message : 'Failed to delete messages';
      return Response.json(error(message), { status: 500 });
    }
  },
);
