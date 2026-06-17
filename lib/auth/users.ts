import { query } from '@/lib/db/pg';

export type AuthUser = {
  id: string;
  email: string;
};

export type UserWithHash = AuthUser & {
  passwordHash: string;
};

/** Thrown by {@link createUser} when the email is already registered. */
export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'EmailTakenError';
  }
}

export async function getUserByEmail(email: string): Promise<UserWithHash | undefined> {
  const rows = await query<UserWithHash>(
    `
    SELECT id::text, email, password_hash AS "passwordHash"
    FROM users
    WHERE lower(email) = lower($1)
    LIMIT 1;
    `,
    [email],
  );
  return rows[0];
}

export async function createUser(email: string, passwordHash: string): Promise<AuthUser> {
  try {
    const rows = await query<AuthUser>(
      `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id::text, email;
      `,
      [email, passwordHash],
    );
    return rows[0];
  } catch (e) {
    // 23505 = unique_violation on the lower(email) index.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === '23505') {
      throw new EmailTakenError();
    }
    throw e;
  }
}
