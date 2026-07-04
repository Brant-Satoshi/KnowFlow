import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import {
  listAccessibleFiles,
  requireKnowledgeBaseAccess,
} from '@/lib/authz/access';
import { isValidUuid } from '@/lib/validation';

export const GET = withAuth(
  'Failed to get files',
  async (req, user) => {
    const { searchParams } = new URL(req.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    if (knowledgeBaseId && !isValidUuid(knowledgeBaseId)) {
      return Response.json(error('Invalid knowledgeBaseId'), { status: 400 });
    }

    if (knowledgeBaseId) {
      await requireKnowledgeBaseAccess(user.id, knowledgeBaseId);
    }

    const files = await listAccessibleFiles(user.id, knowledgeBaseId || undefined);
    return Response.json(success({ files }));
  },
);
