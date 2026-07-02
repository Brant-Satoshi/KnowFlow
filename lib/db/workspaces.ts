import { randomBytes } from 'crypto';
import { and, asc, count, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './pg';
import { users, workspaceInvites, workspaceMembers, workspaces } from './schema/auth';
import type {
  InviteRole,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from '@/lib/types';

type InviteRow = typeof workspaceInvites.$inferSelect;

function toInvite(row: InviteRow): WorkspaceInvite {
  return {
    id: row.id,
    role: row.role as InviteRole,
    token: row.token,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | undefined> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return row ? (row.role as WorkspaceRole) : undefined;
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  // workspace_members appears twice: once filtered to the caller (their role),
  // once aliased over all rows (member count) — the alias avoids SQL name clashes.
  const allMembers = alias(workspaceMembers, 'all_members');
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
      memberCount: count(allMembers.userId),
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(allMembers, eq(allMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .groupBy(workspaces.id, workspaces.name, workspaces.createdAt, workspaceMembers.role)
    .orderBy(asc(workspaces.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role as WorkspaceRole,
    memberCount: r.memberCount,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(
      sql`case when ${workspaceMembers.role} = 'owner' then 0 when ${workspaceMembers.role} = 'admin' then 1 else 2 end`,
      asc(workspaceMembers.createdAt),
    );

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    role: r.role as WorkspaceRole,
    joinedAt: r.joinedAt.toISOString(),
  }));
}

export async function createWorkspaceInvite(
  workspaceId: string,
  createdBy: string,
  role: InviteRole,
  expiresInHours: number,
): Promise<WorkspaceInvite> {
  // Unguessable 128-bit token stored plaintext — same posture as session ids.
  const token = randomBytes(16).toString('base64url');
  const [row] = await db
    .insert(workspaceInvites)
    .values({
      workspaceId,
      role,
      token,
      createdBy,
      expiresAt: sql`now() + make_interval(hours => ${expiresInHours})`,
    })
    .returning();
  return toInvite(row);
}

/** Active (unexpired) invites. `roleFilter` scopes what admins may see. */
export async function listActiveWorkspaceInvites(
  workspaceId: string,
  roleFilter?: InviteRole,
): Promise<WorkspaceInvite[]> {
  const rows = await db
    .select()
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        gt(workspaceInvites.expiresAt, sql`now()`),
        ...(roleFilter ? [eq(workspaceInvites.role, roleFilter)] : []),
      ),
    )
    .orderBy(desc(workspaceInvites.createdAt));
  return rows.map(toInvite);
}

/** `roleFilter` scopes what admins may revoke; out-of-scope ids read as absent. */
export async function revokeWorkspaceInvite(
  workspaceId: string,
  inviteId: string,
  roleFilter?: InviteRole,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspaceId),
        ...(roleFilter ? [eq(workspaceInvites.role, roleFilter)] : []),
      ),
    )
    .returning({ id: workspaceInvites.id });
  return rows.length > 0;
}

export type JoinWorkspaceResult = {
  workspace: { id: string; name: string };
  role: WorkspaceRole;
  alreadyMember: boolean;
};

/** Returns undefined for unknown/expired codes (route maps to a generic 404). */
export async function joinWorkspaceByCode(
  userId: string,
  code: string,
): Promise<JoinWorkspaceResult | undefined> {
  return db.transaction(async (tx) => {
    // Lock the invite row: a concurrent revoke either commits first (this read
    // sees nothing) or waits until this membership insert commits.
    const [invite] = await tx
      .select({ workspaceId: workspaceInvites.workspaceId, role: workspaceInvites.role })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.token, code), gt(workspaceInvites.expiresAt, sql`now()`)))
      .limit(1)
      .for('update');
    if (!invite) return undefined;

    const [workspace] = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);
    if (!workspace) return undefined;

    // onConflictDoNothing makes concurrent duplicate joins idempotent.
    const inserted = await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role })
      .onConflictDoNothing()
      .returning({ role: workspaceMembers.role });

    if (inserted.length > 0) {
      return { workspace, role: inserted[0].role as WorkspaceRole, alreadyMember: false };
    }

    const existingRole = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .limit(1);
    return {
      workspace,
      role: (existingRole[0]?.role ?? invite.role) as WorkspaceRole,
      alreadyMember: true,
    };
  });
}

/** Owner rows never match (`role != 'owner'`) — the single owner is immutable. */
export async function updateWorkspaceMemberRole(
  workspaceId: string,
  targetUserId: string,
  role: InviteRole,
): Promise<WorkspaceRole | undefined> {
  const rows = await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        ne(workspaceMembers.role, 'owner'),
      ),
    )
    .returning({ role: workspaceMembers.role });
  return rows[0] ? (rows[0].role as WorkspaceRole) : undefined;
}

/** Owner rows never match (`role != 'owner'`) — the owner cannot be removed. */
export async function removeWorkspaceMember(
  workspaceId: string,
  targetUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        ne(workspaceMembers.role, 'owner'),
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  return rows.length > 0;
}
