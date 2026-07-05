import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import { isValidUuid } from '@/lib/validation';
import { listRuns } from '@/lib/db/eval';
import { requireKnowledgeBaseAccess } from '@/lib/authz/access';

export const GET = withAuth('Failed to list eval runs', async (req, user) => {
  const { searchParams } = new URL(req.url);
  const knowledgeBaseId = searchParams.get('knowledgeBaseId');

  if (!knowledgeBaseId || !isValidUuid(knowledgeBaseId)) {
    return Response.json(
      error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
      { status: 400 }
    );
  }

  await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);

  const runs = await listRuns(knowledgeBaseId);
  return Response.json(success({ runs }));
});
