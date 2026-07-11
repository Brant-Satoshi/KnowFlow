import { NextRequest } from 'next/server';
import { success, error } from '@/lib/api/response';
import { credentialsSchema } from '@/lib/auth/validation';
import { hashPassword } from '@/lib/auth/password';
import { createUser, EmailTakenError } from '@/lib/auth/users';
import { startSession } from '@/lib/auth/current-user';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(error('Invalid email or password', { code: 'INVALID_INPUT' }), {
        status: 400,
      });
    }

    const { email, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const user = await createUser(email, passwordHash);

    await startSession(user.id);
    return Response.json(success({ user }), { status: 201 });
  } catch (e) {
    if (e instanceof EmailTakenError) {
      return Response.json(error('Email already registered', { code: 'EMAIL_TAKEN' }), {
        status: 409,
      });
    }
    // Keep database/provider details in server logs. Never expose constraint
    // names, SQL text, or connection details in the public envelope.
    console.error('[api/auth/register] Failed to register:', e);
    return Response.json(error('Failed to register'), { status: 500 });
  }
}
