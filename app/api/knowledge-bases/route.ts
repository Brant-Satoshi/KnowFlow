import { success, error } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  getKnowledgeBaseById,
} from '@/lib/db/knowledge-bases';
import { isValidUuid } from '@/lib/validation';
import { requireWorkspaceRole } from '@/lib/authz/access';

export const GET = withAuth('Failed to list knowledge bases', async (req, user) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (id) {
    const knowledgeBase = await getKnowledgeBaseById(id, user.id);
    if (!knowledgeBase) {
      return Response.json(error('Knowledge base not found'), { status: 404 });
    }
    return Response.json(success({ knowledgeBase }));
  }

  // Optional workspace scope; absent = merged view across all memberships.
  const workspaceId = searchParams.get('workspaceId');
  if (workspaceId !== null) {
    if (!isValidUuid(workspaceId)) {
      return Response.json(error('Invalid workspaceId'), { status: 400 });
    }
    await requireWorkspaceRole(user.id, workspaceId);
  }

  const knowledgeBases = await listKnowledgeBases(user.id, workspaceId ?? undefined);
  return Response.json(success({ knowledgeBases }));
});

export const POST = withAuth('Failed to create knowledge base', async (req, user) => {
  const body = await req.json();
  const { name, description, workspaceId } = body;

  if (!name || typeof name !== 'string') {
    return Response.json(error('Name is required'), { status: 400 });
  }

  if (workspaceId !== undefined && workspaceId !== null) {
    if (typeof workspaceId !== 'string' || !isValidUuid(workspaceId)) {
      return Response.json(error('Invalid workspaceId'), { status: 400 });
    }
    await requireWorkspaceRole(user.id, workspaceId);
  }

  const knowledgeBase = await createKnowledgeBase(
    name,
    user.id,
    description,
    typeof workspaceId === 'string' ? workspaceId : undefined,
  );
  return Response.json(success({ knowledgeBase }), { status: 201 });
});
