import { FileDoc } from '@/lib/types';
import { deleteChunksByFileId } from './chunks';
import { query } from './pg';

export async function getFiles(): Promise<FileDoc[]> {
  return query<FileDoc>('SELECT id::text, name, type, size, status, created_at AS "createdAt" FROM files ORDER BY created_at DESC;');
}

export async function getFileById(id: string): Promise<FileDoc | undefined> {
  const rows = await query<FileDoc>(
    'SELECT id::text, name, type, size, status, created_at AS "createdAt" FROM files WHERE id = $1::uuid LIMIT 1;',
    [id]
  );
  return rows[0];
}

export async function addFile(file: FileDoc): Promise<FileDoc> {
   const rows = await query<FileDoc>(
    `
    INSERT INTO files (id, name, type, size, status, created_at)
    VALUES ($1::uuid, $2, $3, $4, $5, $6)
    RETURNING id::text, name, type, size, status, created_at AS "createdAt";
    `,
    [file.id, file.name, file.type, file.size, file.status, file.createdAt]
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
    RETURNING id::text, name, type, size, status, created_at AS "createdAt";
    `,
    [id, status]
  );
  return rows[0];
}