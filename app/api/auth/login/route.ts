import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { credentialsSchema } from '@/lib/auth/validation';
import { verifyPassword } from '@/lib/auth/password';
import { getUserByEmail } from '@/lib/auth/users';
import { startSession } from '@/lib/auth/current-user';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = credentialsSchema.safeParse(body);
    // Same response for bad input and bad credentials to avoid user enumeration.
    const badCredentials = () =>
      Response.json(error('Invalid email or password', { code: 'BAD_CREDENTIALS' }), {
        status: 401,
      });

    if (!parsed.success) return badCredentials();

    const { email, password } = parsed.data;
    const user = await getUserByEmail(email);
    if (!user) return badCredentials();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return badCredentials();

    await startSession(user.id);
    return Response.json(success({ user: { id: user.id, email: user.email } }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to log in';
    return Response.json(error(message), { status: 500 });
  }
}
