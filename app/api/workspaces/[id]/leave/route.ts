import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';
import { removeWorkspaceMember } from '@/lib/db/workspaces';

export async function POST(
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

    const role = await requireWorkspaceRole(auth.id, id);
    if (role === 'owner') {
      // Keeps the single-owner invariant: a workspace never loses its owner.
      return Response.json(
        error('The workspace owner cannot leave', { code: 'OWNER_CANNOT_LEAVE' }),
        { status: 403 },
      );
    }

    const left = await removeWorkspaceMember(id, auth.id);
    if (!left) {
      return Response.json(error('Workspace not found'), { status: 404 });
    }

    return Response.json(success({ left: true }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to leave workspace';
    return Response.json(error(message), { status: 500 });
  }
}
