import { FileDoc } from '@/lib/types';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from './pg';
import { chunks, files } from './schema/core';

type FileRow = typeof files.$inferSelect;

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

export async function getFiles(knowledgeBaseId?: string): Promise<FileDoc[]> {
  const rows = knowledgeBaseId
    ? await db
        .select()
        .from(files)
        .where(eq(files.knowledgeBaseId, knowledgeBaseId))
        .orderBy(desc(files.createdAt))
    : await db.select().from(files).orderBy(desc(files.createdAt));

  return rows.map(toFileDoc);
}

export async function addFile(file: FileDoc, knowledgeBaseId: string): Promise<FileDoc> {
  const rows = await db
    .insert(files)
    .values({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      status: file.status,
      createdAt: new Date(file.createdAt),
      knowledgeBaseId,
    })
    .returning();

  return toFileDoc(rows[0]);
}

export async function deleteFile(id: string): Promise<boolean> {
  const rows = await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.fileId, id));
    return tx.delete(files).where(eq(files.id, id)).returning({ id: files.id });
  });

  return rows.length > 0;
}

/**
 * Atomically claim a file for parsing: flips status to 'parsing' only when no
 * other parse holds it, so concurrent requests can't replace the same file's
 * chunks twice. `force` skips the status check — the escape hatch for a file
 * stuck in 'parsing' after a crashed process (there is no timestamp column to
 * age it out with). Returns undefined when the file is missing or already
 * being parsed.
 */
export async function claimFileForParsing(
  id: string,
  opts: { force?: boolean } = {},
): Promise<FileDoc | undefined> {
  const rows = await db
    .update(files)
    .set({ status: 'parsing' })
    .where(opts.force ? eq(files.id, id) : and(eq(files.id, id), ne(files.status, 'parsing')))
    .returning();

  return rows[0] ? toFileDoc(rows[0]) : undefined;
}

export async function updateFileStatus(
  id: string,
  status: FileDoc['status'],
): Promise<FileDoc | undefined> {
  const rows = await db
    .update(files)
    .set({ status })
    .where(eq(files.id, id))
    .returning();

  return rows[0] ? toFileDoc(rows[0]) : undefined;
}
