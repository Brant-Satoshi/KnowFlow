import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';
import { revokeWorkspaceInvite } from '@/lib/db/workspaces';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> },
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id, inviteId } = await params;
    if (!isValidUuid(id) || !isValidUuid(inviteId)) {
      return Response.json(error('Invalid workspace or invite id'), { status: 400 });
    }

    const role = await requireWorkspaceRole(auth.id, id);
    if (role !== 'owner' && role !== 'admin') {
      return Response.json(
        error('Only the owner or an admin can revoke invites', { code: 'WORKSPACE_FORBIDDEN' }),
        { status: 403 },
      );
    }

    // Admins can only revoke member invites; admin invites read as absent (404).
    const revoked = await revokeWorkspaceInvite(id, inviteId, role === 'admin' ? 'member' : undefined);
    if (!revoked) {
      return Response.json(error('Invite not found'), { status: 404 });
    }

    return Response.json(success({ revoked: true }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to revoke invite';
    return Response.json(error(message), { status: 500 });
  }
}
