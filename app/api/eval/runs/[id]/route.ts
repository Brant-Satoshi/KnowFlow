import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { isValidUuid } from '@/lib/validation';
import { getRunById } from '@/lib/db/eval';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid run ID', { code: 'INVALID_RUN_ID' }),
        { status: 400 }
      );
    }

    const run = await getRunById(id);
    if (!run) {
      return Response.json(
        error('Eval run not found', { code: 'RUN_NOT_FOUND' }),
        { status: 404 }
      );
    }

    return Response.json(success({ run }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load eval run';
    return Response.json(error(message), { status: 500 });
  }
}
