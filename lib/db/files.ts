import { FileDoc } from '@/lib/types';
import { desc, eq } from 'drizzle-orm';
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

export async function getFileById(id: string): Promise<FileDoc | undefined> {
  const rows = await db.select().from(files).where(eq(files.id, id)).limit(1);
  return rows[0] ? toFileDoc(rows[0]) : undefined;
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
