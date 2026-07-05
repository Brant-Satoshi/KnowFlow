import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { requireWorkspaceRole } from '@/lib/authz/access';
import { removeWorkspaceMember } from '@/lib/db/workspaces';

export const POST = withAuth(
  'Failed to leave workspace',
  async (req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;

    const role = await requireWorkspaceRole(user.id, id);
    if (role === 'owner') {
      // Keeps the single-owner invariant: a workspace never loses its owner.
      return Response.json(
        error('The workspace owner cannot leave', { code: 'OWNER_CANNOT_LEAVE' }),
        { status: 403 },
      );
    }

    const left = await removeWorkspaceMember(id, user.id);
    if (!left) {
      return Response.json(error('Workspace not found'), { status: 404 });
    }

    return Response.json(success({ left: true }));
  },
);
