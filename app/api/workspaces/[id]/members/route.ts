import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';
import { listWorkspaceMembers } from '@/lib/db/workspaces';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return Response.json(error('Invalid workspace id'), { status: 400 });
    }

    await requireWorkspaceRole(auth.id, id);

    const members = await listWorkspaceMembers(id);
    return Response.json(success({ members }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to list members';
    return Response.json(error(message), { status: 500 });
  }
}
