import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { requireWorkspaceAdmin } from '@/lib/authz/access';
import { revokeWorkspaceInvite } from '@/lib/db/workspaces';

export const DELETE = withAuth(
  'Failed to revoke invite',
  async (req, user, { params }: { params: Promise<{ id: string; inviteId: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;
    const inviteId = await parseUuidParam(params, 'inviteId', 'invite id');
    if (inviteId instanceof Response) return inviteId;

    const role = await requireWorkspaceAdmin(user.id, id, 'revoke invites');

    // Admins can only revoke member invites; admin invites read as absent (404).
    const revoked = await revokeWorkspaceInvite(id, inviteId, role === 'admin' ? 'member' : undefined);
    if (!revoked) {
      return Response.json(error('Invite not found'), { status: 404 });
    }

    return Response.json(success({ revoked: true }));
  },
);
