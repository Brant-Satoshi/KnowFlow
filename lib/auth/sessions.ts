import { randomBytes } from 'crypto';
import { execute, query } from '@/lib/db/pg';
import type { AuthUser } from './users';

/** Creates an opaque 256-bit session token and persists a 30-day session row. */
export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString('base64url');
  await execute(
    `
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES ($1, $2::uuid, now() + interval '30 days');
    `,
    [id, userId],
  );
  return id;
}

/**
 * Resolves a session id to its user, but only if the session exists and has
 * not expired. Never selects the password hash.
 */
export async function getSessionUser(id: string): Promise<AuthUser | undefined> {
  const rows = await query<AuthUser>(
    `
    SELECT u.id::text, u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1 AND s.expires_at > now()
    LIMIT 1;
    `,
    [id],
  );
  return rows[0];
}

export async function destroySession(id: string): Promise<void> {
  await execute(`DELETE FROM sessions WHERE id = $1;`, [id]);
}
