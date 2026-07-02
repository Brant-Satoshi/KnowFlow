import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';
import {
  getWorkspaceRole,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '@/lib/db/workspaces';

const patchSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id, userId } = await params;
    if (!isValidUuid(id) || !isValidUuid(userId)) {
      return Response.json(error('Invalid workspace or user id'), { status: 400 });
    }

    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(error('role must be "admin" or "member"'), { status: 400 });
    }

    const requesterRole = await requireWorkspaceRole(auth.id, id);
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
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to update member role';
    return Response.json(error(message), { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const { id, userId } = await params;
    if (!isValidUuid(id) || !isValidUuid(userId)) {
      return Response.json(error('Invalid workspace or user id'), { status: 400 });
    }

    const requesterRole = await requireWorkspaceRole(auth.id, id);
    if (requesterRole !== 'owner' && requesterRole !== 'admin') {
      return Response.json(
        error('Only the owner or an admin can remove members', { code: 'WORKSPACE_FORBIDDEN' }),
        { status: 403 },
      );
    }

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
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to remove member';
    return Response.json(error(message), { status: 500 });
  }
}
