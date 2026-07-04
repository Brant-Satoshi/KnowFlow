import { success } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { requireWorkspaceRole } from '@/lib/authz/access';
import { listWorkspaceMembers } from '@/lib/db/workspaces';

export const GET = withAuth(
  'Failed to list members',
  async (req, user, { params }: { params: Promise<{ id: string }> }) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;

    await requireWorkspaceRole(user.id, id);

    const members = await listWorkspaceMembers(id);
    return Response.json(success({ members }));
  },
);
