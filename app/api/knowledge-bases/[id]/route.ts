import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import {
  DEFAULT_KB_NAME,
  getKnowledgeBaseById,
  listKnowledgeBaseDeleteFiles,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '@/lib/db/knowledge-bases';
import { deleteFiles } from '@/lib/db/storage';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(
  'Failed to get knowledge base',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'knowledge base id');
    if (id instanceof Response) return id;

    const knowledgeBase = await getKnowledgeBaseById(id, user.id);

    if (!knowledgeBase) {
      return Response.json(error('Knowledge base not found'), { status: 404 });
    }

    return Response.json(success({ knowledgeBase }));
  },
);

export const PUT = withAuth(
  'Failed to update knowledge base',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'knowledge base id');
    if (id instanceof Response) return id;

    try {
      const existing = await getKnowledgeBaseById(id, user.id);

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

      const updated = await updateKnowledgeBase(id, user.id, {
        name: typeof name === 'string' ? name.trim() : undefined,
        description: typeof description === 'string' ? description.trim() : undefined,
      });

      return Response.json(success({ knowledgeBase: updated }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update knowledge base';
      return Response.json(error(message, { code: 'KB_UPDATE_FAILED' }), { status: 500 });
    }
  },
);

export const DELETE = withAuth(
  'Failed to delete knowledge base',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'knowledge base id');
    if (id instanceof Response) return id;

    try {
      const knowledgeBase = await getKnowledgeBaseById(id, user.id);

      if (!knowledgeBase) {
        return Response.json(error('Knowledge base not found', { code: 'KB_NOT_FOUND' }), { status: 404 });
      }

      if (knowledgeBase.name === DEFAULT_KB_NAME) {
        return Response.json(
          error('Default knowledge base cannot be deleted', { code: 'KB_DELETE_FORBIDDEN' }),
          { status: 403 }
        );
      }

      // Snapshot storage keys before the cascade delete removes the rows.
      // DB rows are the source of truth: delete them first, then clean up
      // blobs best-effort — leftover blobs are harmless and only logged.
      const files = await listKnowledgeBaseDeleteFiles(id, user.id);

      const deleted = await deleteKnowledgeBase(id, user.id);

      if (!deleted) {
        return Response.json(error('Knowledge base not found', { code: 'KB_NOT_FOUND' }), { status: 404 });
      }

      const { failedKeys } = await deleteFiles(files);
      if (failedKeys.length > 0) {
        console.error('Knowledge base storage cleanup failed:', { knowledgeBaseId: id, failedKeys });
      }

      return Response.json(success({ deleted: true }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to delete knowledge base';
      return Response.json(error(message, { code: 'KB_DELETE_FAILED' }), { status: 500 });
    }
  },
);
