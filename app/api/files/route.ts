import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { getFiles } from '@/lib/db/files';
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

    const files = await getFiles(knowledgeBaseId || undefined);
    return Response.json(success({ files }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to get files';
    return Response.json(error(message), { status: 500 });
  }
}
