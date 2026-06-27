import { KnowledgeBase } from '@/lib/types';
import { db } from './pg';
import { chunks, files, knowledgeBases } from '@/lib/db/schema/core';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { workspaceMembers } from './schema/auth';

/** Subquery of every workspace the user belongs to — the KB tenant boundary. */
function userWorkspaceIds(userId: string) {
  return db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
}

type KbRow = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toKnowledgeBase(row: KbRow, chunkCount?: number): KnowledgeBase {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(chunkCount !== undefined ? { chunkCount } : {}),
  };
}

export const DEFAULT_KB_NAME = 'Default Knowledge Base';

export type KnowledgeBaseDeleteFile = {
  id: string;
  name: string;
  knowledgeBaseId: string;
};

export async function listKnowledgeBases(userId: string): Promise<KnowledgeBase[]> {
  const rows = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
      createdAt: knowledgeBases.createdAt,
      updatedAt: knowledgeBases.updatedAt,
      chunkCount: count(chunks.id),
    })
    .from(knowledgeBases)
    .leftJoin(files, eq(files.knowledgeBaseId, knowledgeBases.id))
    .leftJoin(chunks, eq(chunks.fileId, files.id))
    .where(inArray(knowledgeBases.workspaceId, userWorkspaceIds(userId)))
    .groupBy(knowledgeBases.id)
    .orderBy(desc(knowledgeBases.createdAt));

  return rows.map((r) => toKnowledgeBase(r, r.chunkCount));
}

export async function getKnowledgeBaseById(
  id: string,
  userId: string
): Promise<KnowledgeBase | undefined> {
  const rows = await db
    .select()
    .from(knowledgeBases)
    .where(
      and(
        eq(knowledgeBases.id, id),
        inArray(knowledgeBases.workspaceId, userWorkspaceIds(userId))
      )
    )
    .limit(1);
  return rows[0] ? toKnowledgeBase(rows[0]) : undefined;
}

export async function getKnowledgeBaseByName(name: string): Promise<KnowledgeBase | undefined> {
  const rows = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.name, name))
    .limit(1);
  return rows[0] ? toKnowledgeBase(rows[0]) : undefined;
}

export async function getDefaultKnowledgeBase(): Promise<KnowledgeBase | undefined> {
  return getKnowledgeBaseByName(DEFAULT_KB_NAME);
}

async function getDefaultWorkspaceId(userId: string) {
  const [member] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);

  if (!member) {
    throw new Error('User has no workspace');
  }
  return member.workspaceId;
}

export async function createKnowledgeBase(
  name: string,
  userId: string,
  description?: string
): Promise<KnowledgeBase> {
  const workspaceId = await getDefaultWorkspaceId(userId);
  const rows = await db
    .insert(knowledgeBases)
    .values({
      name,
      description: description ?? null,
      userId,
      workspaceId,
    })
    .returning();
  return toKnowledgeBase(rows[0]);
}

export type UpdateKnowledgeBaseInput = {
  name?: string;
  description?: string;
};

export async function updateKnowledgeBase(
  id: string,
  userId: string,
  data: UpdateKnowledgeBaseInput
): Promise<KnowledgeBase | undefined> {
  const patch: Partial<{ name: string; description: string | null }> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description ?? null;

  if (Object.keys(patch).length === 0) {
    return getKnowledgeBaseById(id, userId);
  }

  const rows = await db
    .update(knowledgeBases)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(
      and(
        eq(knowledgeBases.id, id),
        inArray(knowledgeBases.workspaceId, userWorkspaceIds(userId))
      )
    )
    .returning();
  return rows[0] ? toKnowledgeBase(rows[0]) : undefined;
}

export async function listKnowledgeBaseDeleteFiles(
  knowledgeBaseId: string,
  userId: string
): Promise<KnowledgeBaseDeleteFile[]> {
  return db
    .select({
      id: files.id,
      name: files.name,
      knowledgeBaseId: files.knowledgeBaseId,
    })
    .from(files)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, files.knowledgeBaseId))
    .where(
      and(
        eq(files.knowledgeBaseId, knowledgeBaseId),
        inArray(knowledgeBases.workspaceId, userWorkspaceIds(userId))
      )
    )
    .orderBy(desc(files.createdAt));
}

export async function deleteKnowledgeBase(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(knowledgeBases)
    .where(
      and(
        eq(knowledgeBases.id, id),
        inArray(knowledgeBases.workspaceId, userWorkspaceIds(userId))
      )
    )
    .returning({ id: knowledgeBases.id });
  return rows.length > 0;
}


