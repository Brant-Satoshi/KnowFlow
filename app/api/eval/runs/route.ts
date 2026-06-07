import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { isValidUuid } from '@/lib/validation';
import { listRuns } from '@/lib/db/eval';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const knowledgeBaseId = searchParams.get('knowledgeBaseId');

    if (!knowledgeBaseId || !isValidUuid(knowledgeBaseId)) {
      return Response.json(
        error('Valid knowledgeBaseId is required', { code: 'INVALID_KB_ID' }),
        { status: 400 }
      );
    }

    const runs = await listRuns(knowledgeBaseId);
    return Response.json(success({ runs }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list eval runs';
    return Response.json(error(message), { status: 500 });
  }
}
