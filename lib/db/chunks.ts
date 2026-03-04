import { Chunk } from '@/lib/types';
import { query, execute, getPool } from './pg';

export async function getChunks(fileId?: string): Promise<Chunk[]> {
  return query<Chunk>(
    `
    SELECT id::text, file_id AS "fileId", idx, text, meta
    FROM chunks
    ${fileId ? 'WHERE file_id = $1 ORDER BY idx' : 'ORDER BY file_id, idx'}
    `,
    fileId ? [fileId] : []
  );
}

export async function replaceFileChunks(
  fileId: string,
  nextChunks: Chunk[],
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM chunks WHERE file_id = $1', [fileId]);
    for (const chunk of nextChunks) {
      const vector = chunk.embedding
        ? `[${chunk.embedding.join(',')}]`
        : null;
      await client.query(
        'INSERT INTO chunks (id, file_id, idx, text, meta, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)',
        [chunk.id, fileId, chunk.idx, chunk.text, JSON.stringify(chunk.meta), vector]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteChunksByFileId(fileId: string): Promise<number> {
  return execute('DELETE FROM chunks WHERE file_id = $1', [fileId]);
}
