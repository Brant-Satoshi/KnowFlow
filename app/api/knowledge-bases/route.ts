import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  getKnowledgeBaseById,
} from '@/lib/db/knowledge-bases';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const knowledgeBase = await getKnowledgeBaseById(id);
      if (!knowledgeBase) {
        return Response.json(error('Knowledge base not found'), { status: 404 });
      }
      return Response.json(success({ knowledgeBase }));
    }

    const knowledgeBases = await listKnowledgeBases();
    return Response.json(success({ knowledgeBases }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list knowledge bases';
    return Response.json(error(message), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string') {
      return Response.json(error('Name is required'), { status: 400 });
    }

    const knowledgeBase = await createKnowledgeBase(name, description);
    return Response.json(success({ knowledgeBase }), { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to create knowledge base';
    return Response.json(error(message), { status: 500 });
  }
}
