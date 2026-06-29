import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { getChunks } from '@/lib/db/chunks';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireFileAccess } from '@/lib/authz/access';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return Response.json(error('Invalid file ID'), { status: 400 });
    }

    await requireFileAccess(auth.id, id);

    const chunks = await getChunks(id);

    return Response.json(success({
      chunkCount: chunks.length,
      chunks,
    }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Get chunks failed';
    return Response.json(error(message), { status: 500 });
  }
}
