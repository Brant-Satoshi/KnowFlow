import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { deleteMessages } from '@/lib/db/conversations';
import { isValidUuid } from '@/lib/validation';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid conversation ID', { code: 'INVALID_CONVERSATION_ID' }),
        { status: 400 }
      );
    }

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

    const deleted = await deleteMessages(id, messageIds);
    return Response.json(success({ deleted }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete messages';
    return Response.json(error(message), { status: 500 });
  }
}
