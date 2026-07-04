import { success } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { getChunks } from '@/lib/db/chunks';
import { requireFileAccess } from '@/lib/authz/access';

export const GET = withAuth(
  'Get chunks failed',
  async (req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'file id');
    if (id instanceof Response) return id;

    await requireFileAccess(user.id, id);

    const chunks = await getChunks(id);

    return Response.json(success({
      chunkCount: chunks.length,
      chunks,
    }));
  },
);
