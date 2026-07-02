import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { isValidUuid } from '@/lib/validation';
import { isNotFoundOrForbiddenError, requireWorkspaceRole } from '@/lib/authz/access';
import { createWorkspaceInvite, listActiveWorkspaceInvites } from '@/lib/db/workspaces';

const createSchema = z.object({
  role: z.enum(['member', 'admin']).default('member'),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

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

    const role = await requireWorkspaceRole(auth.id, id);
    if (role !== 'owner' && role !== 'admin') {
      return Response.json(
        error('Only the owner or an admin can view invites', { code: 'WORKSPACE_FORBIDDEN' }),
        { status: 403 },
      );
    }

    // Admins never see admin-role invite tokens — those are owner-only.
    const invites = await listActiveWorkspaceInvites(id, role === 'admin' ? 'member' : undefined);
    return Response.json(success({ invites }));
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to list invites';
    return Response.json(error(message), { status: 500 });
  }
}

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

    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return Response.json(
        error('role must be "member" or "admin" and expiresInHours an integer between 1 and 168'),
        { status: 400 },
      );
    }

    const requesterRole = await requireWorkspaceRole(auth.id, id);
    if (requesterRole !== 'owner' && requesterRole !== 'admin') {
      return Response.json(
        error('Only the owner or an admin can create invites', { code: 'WORKSPACE_FORBIDDEN' }),
        { status: 403 },
      );
    }
    if (parsed.data.role === 'admin' && requesterRole !== 'owner') {
      return Response.json(
        error('Only the owner can create admin invites', { code: 'INVITE_ROLE_FORBIDDEN' }),
        { status: 403 },
      );
    }

    const invite = await createWorkspaceInvite(
      id,
      auth.id,
      parsed.data.role,
      parsed.data.expiresInHours,
    );
    return Response.json(success({ invite }), { status: 201 });
  } catch (e) {
    if (isNotFoundOrForbiddenError(e)) {
      return Response.json(error(e.message), { status: 404 });
    }
    const message = e instanceof Error ? e.message : 'Failed to create invite';
    return Response.json(error(message), { status: 500 });
  }
}
