import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { embedChunk } from '@/lib/rag/embeddings';
import { searchChunks } from '@/lib/db/chunks';

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const { query, fileId, topK = 5, maxDistance = 0.4 } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return Response.json(error('Missing query'), { status: 400 });
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

    const queryChunks = await embedChunk(
      [{ id: 'query', fileId: '', idx: 0, text: query, meta: {} }],
      { signal: req.signal }
    );
    const queryEmbedding = queryChunks[0].embedding;

    if (!queryEmbedding) {
      return Response.json(error('Failed to embed query'), { status: 500 });
    }

    const chunks = await searchChunks(queryEmbedding, topK, maxDistance, fileId);

    return Response.json(success({ chunks }));
  } catch (e) {
    console.error('search error:', e);
    return Response.json(error('Search failed'), { status: 500 });
  }

}
