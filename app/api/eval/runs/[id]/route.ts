import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { getRunById } from '@/lib/db/eval';
import { isNotFoundOrForbiddenError, requireEvalRunAccess } from '@/lib/authz/access';

export const GET = withAuth(
  'Failed to load eval run',
  async (_req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'run id');
    if (id instanceof Response) return id;

    try {
      await requireEvalRunAccess(user.id, id);

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
  },
);
