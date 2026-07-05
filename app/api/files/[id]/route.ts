import { success } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { deleteFile } from '@/lib/db/files';
import { deleteFile as deleteStorageFile } from '@/lib/db/storage';
import { requireFileAccess } from '@/lib/authz/access';

export const DELETE = withAuth(
  'Delete failed',
  async (req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'file id');
    if (id instanceof Response) return id;

    const file = await requireFileAccess(user.id, id);

    await deleteStorageFile(id, file.name);
    await deleteFile(id);

    return Response.json(success({ deleted: true }));
  },
);
