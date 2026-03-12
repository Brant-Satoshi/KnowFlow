import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import {
  getKnowledgeBaseById,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '@/lib/db/knowledge-bases';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const knowledgeBase = await getKnowledgeBaseById(id);

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
  try {
    const { id } = await params;
    const existing = await getKnowledgeBaseById(id);

    if (!existing) {
      return Response.json(error('Knowledge base not found'), { status: 404 });
    }

    const body: unknown = await req.json();
    if (!body || typeof body !== 'object') {
      return Response.json(error('Invalid request body'), { status: 400 });
    }

    const { name, description } = body as Record<string, unknown>;

    // name: 非空字符串
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return Response.json(error('Name must be a non-empty string'), { status: 400 });
    }

    // description: 字符串或 undefined
    if (description !== undefined && typeof description !== 'string') {
      return Response.json(error('Description must be a string'), { status: 400 });
    }

    const updated = await updateKnowledgeBase(id, {
      name: typeof name === 'string' ? name : undefined,
      description,
    });
    return Response.json(success({ knowledgeBase: updated }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update knowledge base';
    return Response.json(error(message), { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteKnowledgeBase(id);

    if (!deleted) {
      return Response.json(error('Knowledge base not found'), { status: 404 });
    }

    return Response.json(success({ deleted: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete knowledge base';
    return Response.json(error(message), { status: 500 });
  }
}
