import { cookies } from 'next/headers';
import { error } from '@/lib/api/response';
import { SESSION_COOKIE, sessionCookieOptions } from './cookie';
import { createSession, destroySession, getSessionUser } from './sessions';
import type { AuthUser } from './users';

/**
 * Node-only auth helpers. These import `pg` (via sessions) and `next/headers`,
 * so they must never be imported by the Edge middleware.
 */

export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return (await getSessionUser(id)) ?? null;
}

/**
 * Guard for business API routes. Returns the current user, or a ready-to-return
 * 401 JSON `Response` when unauthenticated. Call sites use:
 *
 *   const auth = await requireUser();
 *   if (auth instanceof Response) return auth;
 */
export async function requireUser(): Promise<AuthUser | Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json(error('Unauthorized', { code: 'UNAUTHORIZED' }), { status: 401 });
  }
  return user;
}

/** Creates a session and sets the session cookie. */
export async function startSession(userId: string): Promise<void> {
  const id = await createSession(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, id, sessionCookieOptions);
}

/** Destroys the current session (if any) and clears the cookie. */
export async function endSession(): Promise<void> {
  const cookieStore = await cookies();
  const id = cookieStore.get(SESSION_COOKIE)?.value;
  if (id) await destroySession(id);
  cookieStore.delete(SESSION_COOKIE);
}
