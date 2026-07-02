import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  getKnowledgeBaseById,
} from '@/lib/db/knowledge-bases';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const knowledgeBase = await getKnowledgeBaseById(id, auth.id);
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
      await requireWorkspaceRole(auth.id, workspaceId);
    }

    const knowledgeBases = await listKnowledgeBases(auth.id, workspaceId ?? undefined);
    return Response.json(success({ knowledgeBases }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to list knowledge bases';
    return Response.json(error(message), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const { name, description, workspaceId } = body;

    if (!name || typeof name !== 'string') {
      return Response.json(error('Name is required'), { status: 400 });
    }

    if (workspaceId !== undefined && workspaceId !== null) {
      if (typeof workspaceId !== 'string' || !isValidUuid(workspaceId)) {
        return Response.json(error('Invalid workspaceId'), { status: 400 });
      }
      await requireWorkspaceRole(auth.id, workspaceId);
    }

    const knowledgeBase = await createKnowledgeBase(
      name,
      auth.id,
      description,
      typeof workspaceId === 'string' ? workspaceId : undefined,
    );
    return Response.json(success({ knowledgeBase }), { status: 201 });
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to create knowledge base';
    return Response.json(error(message), { status: 500 });
  }
}
