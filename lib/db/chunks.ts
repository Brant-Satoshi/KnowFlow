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

export async function sampleKbChunks(
  knowledgeBaseId: string,
  limit: number = 5,
): Promise<Chunk[]> {
  return query<Chunk>(
    `
    SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text, c.meta, f.name AS "fileName"
    FROM chunks c
    JOIN files f ON c.file_id = f.id::uuid
    WHERE c.embedding IS NOT NULL
    AND f.knowledge_base_id = $1::uuid
    AND f.status = 'indexed'
    ORDER BY c.file_id, c.idx
    LIMIT $2
    `,
    [knowledgeBaseId, limit],
  );
}

export async function searchChunks(
  queryEmbedding: number[],
  topK: number = 5,
  maxScore: number = 0.4,
  fileId?: string,
  knowledgeBaseId?: string,
): Promise<Chunk[]> {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // If knowledgeBaseId is provided, join with files to filter by knowledge base
  if (knowledgeBaseId) {
    return query<Chunk>(
      `
      SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text, c.meta, f.name AS "fileName"
      FROM chunks c
      JOIN files f ON c.file_id = f.id::uuid
      WHERE c.embedding IS NOT NULL
      AND c.embedding <=> $1::vector < $2
      AND f.knowledge_base_id = $3::uuid
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4
      `,
      [vectorStr, maxScore, knowledgeBaseId, topK]
    );
  }

  return query<Chunk>(
    `
    SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text, c.meta, f.name AS "fileName"
    FROM chunks c
    JOIN files f ON c.file_id = f.id::uuid
    WHERE c.embedding IS NOT NULL
    AND c.embedding <=> $1::vector < $2
    ${fileId ? 'AND c.file_id = $3' : ''}
    ORDER BY c.embedding <=> $1::vector
    LIMIT ${fileId ? '$4' : '$3'}
    `,
    fileId
      ? [vectorStr, maxScore, fileId, topK]
      : [vectorStr, maxScore, topK]
  );
}
