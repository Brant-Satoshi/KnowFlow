import { z } from 'zod';
import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { requireWorkspaceAdmin, requireWorkspaceRole } from '@/lib/authz/access';
import {
  getWorkspaceRole,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '@/lib/db/workspaces';

const patchSchema = z.object({
  role: z.enum(['admin', 'member']),
});

type Ctx = { params: Promise<{ id: string; userId: string }> };

export const PATCH = withAuth(
  'Failed to update member role',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;
    const userId = await parseUuidParam(params, 'userId', 'user id');
    if (userId instanceof Response) return userId;

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(error('role must be "admin" or "member"'), { status: 400 });
    }

    const requesterRole = await requireWorkspaceRole(user.id, id);
    if (requesterRole !== 'owner') {
      return Response.json(
        error('Only the owner can change roles', { code: 'ROLE_CHANGE_FORBIDDEN' }),
        { status: 403 },
      );
    }

    const targetRole = await getWorkspaceRole(userId, id);
    if (!targetRole) {
      return Response.json(error('Member not found'), { status: 404 });
    }
    if (targetRole === 'owner') {
      return Response.json(
        error('The owner role cannot be changed', { code: 'OWNER_IMMUTABLE' }),
        { status: 403 },
      );
    }

    const role = await updateWorkspaceMemberRole(id, userId, parsed.data.role);
    if (!role) {
      return Response.json(error('Member not found'), { status: 404 });
    }

    return Response.json(success({ member: { userId, role } }));
  },
);

export const DELETE = withAuth(
  'Failed to remove member',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;
    const userId = await parseUuidParam(params, 'userId', 'user id');
    if (userId instanceof Response) return userId;

    const requesterRole = await requireWorkspaceAdmin(user.id, id, 'remove members');

    const targetRole = await getWorkspaceRole(userId, id);
    if (!targetRole) {
      return Response.json(error('Member not found'), { status: 404 });
    }
    if (targetRole === 'owner') {
      return Response.json(
        error('The owner cannot be removed', { code: 'OWNER_IMMUTABLE' }),
        { status: 403 },
      );
    }
    // Also blocks admin self-removal — admins leave via POST /leave instead.
    if (requesterRole === 'admin' && targetRole !== 'member') {
      return Response.json(
        error('Admins can only remove members', { code: 'ADMIN_CANNOT_REMOVE' }),
        { status: 403 },
      );
    }

    const removed = await removeWorkspaceMember(id, userId);
    if (!removed) {
      return Response.json(error('Member not found'), { status: 404 });
    }

    return Response.json(success({ removed: true }));
  },
);
