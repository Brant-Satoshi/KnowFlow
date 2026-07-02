import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { joinWorkspaceByCode } from '@/lib/db/workspaces';

const joinSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const parsed = joinSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(error('A valid invite code is required'), { status: 400 });
    }

    const result = await joinWorkspaceByCode(auth.id, parsed.data.code);
    if (!result) {
      // Generic message on purpose: never reveal whether a code existed or expired.
      return Response.json(
        error('Invalid or expired invite code', { code: 'INVITE_INVALID' }),
        { status: 404 },
      );
    }

    return Response.json(
      success({
        workspace: { ...result.workspace, role: result.role },
        alreadyMember: result.alreadyMember,
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to join workspace';
    return Response.json(error(message), { status: 500 });
  }
}
