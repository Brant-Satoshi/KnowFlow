import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { getFileById } from '@/lib/db/files';
import { getChunks } from '@/lib/db/chunks';
import { isValidUuid } from '@/lib/validation';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return Response.json(error('Invalid file ID'), { status: 400 });
    }

    const file = await getFileById(id);

    if (!file) {
      return Response.json(error('File not found'), { status: 404 });
    }

    const chunks = await getChunks(id);

    return Response.json(success({
      chunkCount: chunks.length,
      chunks,
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Get chunks failed';
    return Response.json(error(message), { status: 500 });
  }
}
