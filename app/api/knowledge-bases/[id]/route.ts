import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import {
  DEFAULT_KB_NAME,
  getKnowledgeBaseById,
  listKnowledgeBaseDeleteFiles,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '@/lib/db/knowledge-bases';
import { deleteFiles } from '@/lib/db/storage';
import { isValidUuid } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    const knowledgeBase = await getKnowledgeBaseById(id, auth.id);

    if (!knowledgeBase) {
      return Response.json(error('Knowledge base not found'), { status: 404 });
    }

    return Response.json(success({ knowledgeBase }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to get knowledge base';
    return Response.json(error(message), { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    const existing = await getKnowledgeBaseById(id, auth.id);

    if (!existing) {
      return Response.json(error('Knowledge base not found', { code: 'KB_NOT_FOUND' }), { status: 404 });
    }

    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return Response.json(error('Invalid request body', { code: 'KB_UPDATE_FAILED' }), { status: 400 });
    }

    const { name, description } = body as Record<string, unknown>;

    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return Response.json(error('Name must be a non-empty string', { code: 'KB_UPDATE_FAILED' }), { status: 400 });
    }

    if (description !== undefined && typeof description !== 'string') {
      return Response.json(error('Description must be a string', { code: 'KB_UPDATE_FAILED' }), { status: 400 });
    }

    const updated = await updateKnowledgeBase(id, auth.id, {
      name: typeof name === 'string' ? name.trim() : undefined,
      description: typeof description === 'string' ? description.trim() : undefined,
    });

    return Response.json(success({ knowledgeBase: updated }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update knowledge base';
    return Response.json(error(message, { code: 'KB_UPDATE_FAILED' }), { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return Response.json(error('Invalid knowledge base ID', { code: 'INVALID_KB_ID' }), { status: 400 });
    }

    const knowledgeBase = await getKnowledgeBaseById(id, auth.id);

    if (!knowledgeBase) {
      return Response.json(error('Knowledge base not found', { code: 'KB_NOT_FOUND' }), { status: 404 });
    }

    if (knowledgeBase.name === DEFAULT_KB_NAME) {
      return Response.json(
        error('Default knowledge base cannot be deleted', { code: 'KB_DELETE_FORBIDDEN' }),
        { status: 403 }
      );
    }

    const files = await listKnowledgeBaseDeleteFiles(id, auth.id);
    const { failedKeys } = await deleteFiles(files);

    if (failedKeys.length > 0) {
      console.error('Knowledge base storage cleanup failed:', { knowledgeBaseId: id, failedKeys });
      return Response.json(
        error('Failed to delete one or more storage objects.', {
          code: 'KB_STORAGE_CLEANUP_FAILED',
          failedKeys,
        }),
        { status: 500 }
      );
    }

    const deleted = await deleteKnowledgeBase(id, auth.id);

    if (!deleted) {
      return Response.json(error('Knowledge base not found', { code: 'KB_NOT_FOUND' }), { status: 404 });
    }

    return Response.json(success({ deleted: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete knowledge base';
    return Response.json(error(message, { code: 'KB_DELETE_FAILED' }), { status: 500 });
  }
}
