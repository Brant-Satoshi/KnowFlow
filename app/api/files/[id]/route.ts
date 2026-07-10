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

    // DB rows are the source of truth: delete them first, then clean up the
    // blob best-effort. An orphaned blob is harmless; a row whose blob is
    // gone is not (the file could never be re-parsed).
    await deleteFile(id);

    const removed = await deleteStorageFile(id, file.name);
    if (!removed) {
      console.error(`[api/files] Orphaned storage object left behind for file ${id} (${file.name})`);
    }

    return Response.json(success({ deleted: true }));
  },
);
