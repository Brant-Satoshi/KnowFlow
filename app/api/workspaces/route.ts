import { success } from '@/lib/api/response';
import { withAuth } from '@/lib/api/route';
import { listUserWorkspaces } from '@/lib/db/workspaces';

export const GET = withAuth('Failed to list workspaces', async (req, user) => {
  const workspaces = await listUserWorkspaces(user.id);
  return Response.json(success({ workspaces }));
});
