import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/pg';
import { files, knowledgeBases, conversations } from '@/lib/db/schema/core';
import { evalRuns } from '@/lib/db/schema/eval';
import { workspaceMembers } from '@/lib/db/schema/auth';
import { getKnowledgeBaseById } from '@/lib/db/knowledge-bases';
import type { ConversationSummary, FileDoc } from '@/lib/types';

type FileRow = typeof files.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;

function toFileDoc(row: FileRow): FileDoc {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    status: row.status as FileDoc['status'],
    createdAt: row.createdAt.toISOString(),
    knowledgeBaseId: row.knowledgeBaseId,
  };
}

function toConversationSummary(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    title: row.title,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class NotFoundOrForbiddenError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundOrForbiddenError';
  }
}

export function isNotFoundOrForbiddenError(e: unknown): e is NotFoundOrForbiddenError {
  return e instanceof NotFoundOrForbiddenError;
}

export async function requireKnowledgeBaseAccess(userId: string, knowledgeBaseId: string) {
  const kb = await getKnowledgeBaseById(knowledgeBaseId, userId);
  if (!kb) throw new NotFoundOrForbiddenError('Knowledge base not found');
  return kb;
}

function userWorkspaceJoin(userId: string) {
  return and(
    eq(workspaceMembers.workspaceId, knowledgeBases.workspaceId),
    eq(workspaceMembers.userId, userId),
  );
}

export async function listAccessibleFiles(
  userId: string,
  knowledgeBaseId?: string,
): Promise<FileDoc[]> {
  const rows = await db
    .select({ file: files })
    .from(files)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, files.knowledgeBaseId))
    .innerJoin(workspaceMembers, userWorkspaceJoin(userId))
    .where(knowledgeBaseId ? eq(files.knowledgeBaseId, knowledgeBaseId) : undefined)
    .orderBy(desc(files.createdAt));

  return rows.map(row => toFileDoc(row.file));
}

export async function requireFileAccess(userId: string, fileId: string): Promise<FileDoc> {
  const [row] = await db
    .select({ file: files })
    .from(files)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, files.knowledgeBaseId))
    .innerJoin(workspaceMembers, userWorkspaceJoin(userId))
    .where(eq(files.id, fileId))
    .limit(1);

  if (!row) throw new NotFoundOrForbiddenError('File not found');
  return toFileDoc(row.file);
}

export async function requireConversationAccess(
  userId: string,
  conversationId: string,
): Promise<ConversationSummary> {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversations)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, conversations.knowledgeBaseId))
    .innerJoin(workspaceMembers, userWorkspaceJoin(userId))
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!row) throw new NotFoundOrForbiddenError('Conversation not found');
  return toConversationSummary(row.conversation);
}

export async function requireEvalRunAccess(userId: string, runId: string) {
  const [row] = await db
    .select({ run: evalRuns })
    .from(evalRuns)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, evalRuns.knowledgeBaseId))
    .innerJoin(workspaceMembers, userWorkspaceJoin(userId))
    .where(eq(evalRuns.id, runId))
    .limit(1);

  if (!row) throw new NotFoundOrForbiddenError('Eval run not found');
  return row.run;
}
