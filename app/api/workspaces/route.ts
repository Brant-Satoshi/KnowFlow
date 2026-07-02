import { success, error } from '@/lib/api/response';
import { requireUser } from '@/lib/auth/current-user';
import { listUserWorkspaces } from '@/lib/db/workspaces';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  try {
    const workspaces = await listUserWorkspaces(auth.id);
    return Response.json(success({ workspaces }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to list workspaces';
    return Response.json(error(message), { status: 500 });
  }
}
