import { FileDoc } from '@/lib/types';
import { deleteChunksByFileId } from './chunks';
import { query } from './pg';

export async function getFiles(knowledgeBaseId?: string): Promise<FileDoc[]> {
  if (knowledgeBaseId) {
    return query<FileDoc>(
      'SELECT id::text, name, type, size, status, created_at AS "createdAt", knowledge_base_id AS "knowledgeBaseId" FROM files WHERE knowledge_base_id = $1::uuid ORDER BY created_at DESC;',
      [knowledgeBaseId]
    );
  }
  return query<FileDoc>('SELECT id::text, name, type, size, status, created_at AS "createdAt", knowledge_base_id AS "knowledgeBaseId" FROM files ORDER BY created_at DESC;');
}

export async function getFileById(id: string): Promise<FileDoc | undefined> {
  const rows = await query<FileDoc>(
    'SELECT id::text, name, type, size, status, created_at AS "createdAt", knowledge_base_id AS "knowledgeBaseId" FROM files WHERE id = $1::uuid LIMIT 1;',
    [id]
  );
  return rows[0];
}

export async function addFile(file: FileDoc, knowledgeBaseId: string): Promise<FileDoc> {
   const rows = await query<FileDoc>(
    `
    INSERT INTO files (id, name, type, size, status, created_at, knowledge_base_id)
    VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
    RETURNING id::text, name, type, size, status, created_at AS "createdAt", knowledge_base_id AS "knowledgeBaseId";
    `,
    [file.id, file.name, file.type, file.size, file.status, file.createdAt, knowledgeBaseId]
  );
  return rows[0];
}

export async function deleteFile(id: string): Promise<boolean> {

  await deleteChunksByFileId(id);
  const rows = await query<{ id: string }>(
    `DELETE FROM files WHERE id = $1::uuid RETURNING id::text AS "id";`,
    [id]
  );
  return rows.length > 0;
}

export async function updateFileStatus(
  id: string,
  status: FileDoc['status'],
): Promise<FileDoc | undefined> {
  const rows = await query<FileDoc>(
    `
    UPDATE files
    SET status = $2
    WHERE id = $1::uuid
    RETURNING id::text, name, type, size, status, created_at AS "createdAt", knowledge_base_id AS "knowledgeBaseId";
    `,
    [id, status]
  );
  return rows[0];
}
