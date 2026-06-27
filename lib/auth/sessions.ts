import { randomBytes } from 'crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/pg';
import { sessions, users } from '@/lib/db/schema/auth';
import type { AuthUser } from './users';

/** Creates an opaque 256-bit session token and persists a 30-day session row. */
export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: sql`now() + interval '30 days'`,
  });
  return id;
}

/**
 * Resolves a session id to its user, but only if the session exists and has
 * not expired. Never selects the password hash.
 */
export async function getSessionUser(id: string): Promise<AuthUser | undefined> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return rows[0];
}

export async function destroySession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}
