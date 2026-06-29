import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { listRuns } from '@/lib/db/eval';
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

    const runs = await listRuns(knowledgeBaseId);
    return Response.json(success({ runs }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to list eval runs';
    return Response.json(error(message), { status: 500 });
  }
}
