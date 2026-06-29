import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { getRunById } from '@/lib/db/eval';
import { isNotFoundOrForbiddenError, requireEvalRunAccess } from '@/lib/authz/access';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(
        error('Invalid run ID', { code: 'INVALID_RUN_ID' }),
        { status: 400 }
      );
    }

    await requireEvalRunAccess(auth.id, id);

    const run = await getRunById(id);
    if (!run) {
      return Response.json(
        error('Eval run not found', { code: 'RUN_NOT_FOUND' }),
        { status: 404 }
      );
    }

    return Response.json(success({ run }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message, { code: 'RUN_NOT_FOUND' }), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to load eval run';
    return Response.json(error(message), { status: 500 });
  }
}
