import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import {
  isNotFoundOrForbiddenError,
  listAccessibleFiles,
  requireKnowledgeBaseAccess,
} from '@/lib/authz/access';
import { isValidUuid } from '@/lib/validation';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    if (knowledgeBaseId && !isValidUuid(knowledgeBaseId)) {
      return Response.json(error('Invalid knowledgeBaseId'), { status: 400 });
    }

    if (knowledgeBaseId) {
      await requireKnowledgeBaseAccess(auth.id, knowledgeBaseId);
    }

    const files = await listAccessibleFiles(auth.id, knowledgeBaseId || undefined);
    return Response.json(success({ files }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to get files';
    return Response.json(error(message), { status: 500 });
  }
}
