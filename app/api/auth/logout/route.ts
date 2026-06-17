import { success, error } from '@/lib/api/response';
import { endSession } from '@/lib/auth/current-user';

export async function POST() {
  try {
    await endSession();
    return Response.json(success({ ok: true }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to log out';
    return Response.json(error(message), { status: 500 });
  }
}
