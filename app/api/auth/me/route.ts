import { success, error } from '@/lib/api/response';
import { getCurrentUser } from '@/lib/auth/current-user';

export async function GET() {
  try {
    // Always 200 — an unauthenticated probe returns { user: null } rather than
    // 401, so the client's httpClient (which throws on ok !== true) can read it.
    const user = await getCurrentUser();
    return Response.json(success({ user }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to load session';
    return Response.json(error(message), { status: 500 });
  }
}
