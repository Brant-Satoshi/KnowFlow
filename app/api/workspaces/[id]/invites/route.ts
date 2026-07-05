import { z } from 'zod';
import { success, error } from '@/lib/api/response';
import { parseUuidParam, withAuth } from '@/lib/api/route';
import { requireWorkspaceAdmin } from '@/lib/authz/access';
import { createWorkspaceInvite, listActiveWorkspaceInvites } from '@/lib/db/workspaces';

const createSchema = z.object({
  role: z.enum(['member', 'admin']).default('member'),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth(
  'Failed to list invites',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;

    const role = await requireWorkspaceAdmin(user.id, id, 'view invites');

    // Admins never see admin-role invite tokens — those are owner-only.
    const invites = await listActiveWorkspaceInvites(id, role === 'admin' ? 'member' : undefined);
    return Response.json(success({ invites }));
  },
);

export const POST = withAuth(
  'Failed to create invite',
  async (req, user, { params }: Ctx) => {
    const id = await parseUuidParam(params, 'id', 'workspace id');
    if (id instanceof Response) return id;

    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return Response.json(
        error('role must be "member" or "admin" and expiresInHours an integer between 1 and 168'),
        { status: 400 },
      );
    }

    const requesterRole = await requireWorkspaceAdmin(user.id, id, 'create invites');
    if (parsed.data.role === 'admin' && requesterRole !== 'owner') {
      return Response.json(
        error('Only the owner can create admin invites', { code: 'INVITE_ROLE_FORBIDDEN' }),
        { status: 403 },
      );
    }

    const invite = await createWorkspaceInvite(
      id,
      user.id,
      parsed.data.role,
      parsed.data.expiresInHours,
    );
    return Response.json(success({ invite }), { status: 201 });
  },
);
