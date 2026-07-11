import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/pg';
import { users, workspaces, workspaceMembers } from '@/lib/db/schema/auth';

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

type ErrorWithCause = {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
};

/**
 * Drizzle may wrap the underlying node-postgres error in `cause`. Some driver
 * wrappers retain code=23505 but omit `constraint`; accept that shape here
 * deliberately because this transaction's other unique keys all contain
 * freshly generated user/workspace ids. Revisit the fallback if another
 * uniqueness-constrained insert is added to this transaction.
 */
function isEmailUniqueViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;

  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);

    const candidate = current as ErrorWithCause;
    if (
      candidate.code === '23505' &&
      (candidate.constraint === undefined || candidate.constraint === 'users_email_unique')
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

export async function getUserByEmail(email: string): Promise<UserWithHash | undefined> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash
    })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return rows[0];
}

function defaultWorkspaceName(email: string) {
  const name = email.split('@')[0]?.trim();

  if (!name) {
    return 'My Workspace';
  }

  return `${name}'s Workspace`;
}

export async function createUser(email: string, passwordHash: string): Promise<AuthUser> {
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
        })
        .returning({
          id: users.id,
          email: users.email,
        });

      if (!user) {
        throw new Error('Failed to create user');
      }

      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: defaultWorkspaceName(email),
          ownerId: user.id,
        })
        .returning({
          id: workspaces.id,
        });

      if (!workspace) {
        throw new Error('Failed to create workspace');
      }

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      });

      return user;
    });
  } catch (e) {
    // 23505 = unique_violation on the lower(email) index.
    if (isEmailUniqueViolation(e)) {
      throw new EmailTakenError();
    }
    throw e;
  }
}
