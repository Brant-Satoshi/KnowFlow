import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { embedChunk } from '@/lib/rag/embeddings';
import { searchChunks } from '@/lib/db/chunks';
import {
  isNotFoundOrForbiddenError,
  requireFileAccess,
  requireKnowledgeBaseAccess,
} from '@/lib/authz/access';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const {
      query,
      fileId: rawFileId,
      knowledgeBaseId: rawKnowledgeBaseId,
      topK = 5,
      maxDistance = 0.4,
    } = body;
    const fileId = typeof rawFileId === 'string' ? rawFileId : undefined;
    const knowledgeBaseId = typeof rawKnowledgeBaseId === 'string' ? rawKnowledgeBaseId : undefined;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return Response.json(error('Missing query'), { status: 400 });
    }
    if (rawFileId !== undefined && rawFileId !== null && typeof rawFileId !== 'string') {
      return Response.json(error('fileId must be a string'), { status: 400 });
    }
    if (
      rawKnowledgeBaseId !== undefined &&
      rawKnowledgeBaseId !== null &&
      typeof rawKnowledgeBaseId !== 'string'
    ) {
      return Response.json(error('knowledgeBaseId must be a string'), { status: 400 });
    }

    if (typeof topK !== 'number' || topK < 1 || topK > 20) {
      return Response.json(error('topK must be between 1 and 20'), { status: 400 });
    }
    if (typeof maxDistance !== 'number' || maxDistance < 0 || maxDistance > 1) {
      return Response.json(error('maxDistance must be between 0 and 1'), { status: 400 });
    }

    if (fileId && !isValidUuid(fileId)) {
      return Response.json(error('Invalid fileId'), { status: 400 });
    }
    if (knowledgeBaseId && !isValidUuid(knowledgeBaseId)) {
      return Response.json(error('Invalid knowledgeBaseId'), { status: 400 });
    }
    if (!fileId && !knowledgeBaseId) {
      return Response.json(error('knowledgeBaseId or fileId is required'), { status: 400 });
    }

    const queryChunks = await embedChunk(
      [{ id: 'query', fileId: '', idx: 0, text: query, meta: {} }],
      { signal: req.signal }
    );
    const queryEmbedding = queryChunks[0].embedding;

    if (!queryEmbedding) {
      return Response.json(error('Failed to embed query'), { status: 500 });
    }

    let chunks;
    if (fileId) {
      const file = await requireFileAccess(auth.id, fileId);
      if (knowledgeBaseId && file.knowledgeBaseId !== knowledgeBaseId) {
        return Response.json(error('File does not belong to this knowledge base'), { status: 400 });
      }
      chunks = await searchChunks(queryEmbedding, topK, maxDistance, file.id);
    } else if (knowledgeBaseId) {
      await requireKnowledgeBaseAccess(auth.id, knowledgeBaseId);
      chunks = await searchChunks(queryEmbedding, topK, maxDistance, undefined, knowledgeBaseId);
    }

    return Response.json(success({ chunks }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    console.error('search error:', e);
    return Response.json(error('Search failed'), { status: 500 });
  }

}
