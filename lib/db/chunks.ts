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
        'INSERT INTO chunks (id, file_id, idx, text, embedding_text, document_title, section_title, meta, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)',
        [
          chunk.id,
          fileId,
          chunk.idx,
          chunk.text,
          chunk.embeddingText ?? chunk.text,
          chunk.documentTitle ?? null,
          chunk.sectionTitle ?? null,
          JSON.stringify(chunk.meta),
          vector,
        ]
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

type ChunkWithDistance = Chunk & { distance: number };

function attachDistance(rows: ChunkWithDistance[]): Chunk[] {
  return rows.map(({ distance, ...chunk }) => ({
    ...chunk,
    meta: { ...(chunk.meta ?? {}), _distance: distance },
  }));
}

export async function searchChunks(
  queryEmbedding: number[],
  topK: number = 5,
  maxDistance: number = 0.4,
  fileId?: string,
  knowledgeBaseId?: string,
): Promise<Chunk[]> {
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  // If knowledgeBaseId is provided, join with files to filter by knowledge base
  if (knowledgeBaseId) {
    const rows = await query<ChunkWithDistance>(
      `
      SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text,
             c.embedding_text AS "embeddingText", c.document_title AS "documentTitle",
             c.section_title AS "sectionTitle", c.meta, f.name AS "fileName",
             c.embedding <=> $1::vector AS distance
      FROM chunks c
      JOIN files f ON c.file_id = f.id::uuid
      WHERE c.embedding IS NOT NULL
      AND c.embedding <=> $1::vector < $2
      AND f.knowledge_base_id = $3::uuid
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4
      `,
      [vectorStr, maxDistance, knowledgeBaseId, topK]
    );
    return attachDistance(rows);
  }

  const rows = await query<ChunkWithDistance>(
    `
    SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text,
           c.embedding_text AS "embeddingText", c.document_title AS "documentTitle",
           c.section_title AS "sectionTitle", c.meta, f.name AS "fileName",
           c.embedding <=> $1::vector AS distance
    FROM chunks c
    JOIN files f ON c.file_id = f.id::uuid
    WHERE c.embedding IS NOT NULL
    AND c.embedding <=> $1::vector < $2
    ${fileId ? 'AND c.file_id = $3' : ''}
    ORDER BY c.embedding <=> $1::vector
    LIMIT ${fileId ? '$4' : '$3'}
    `,
    fileId
      ? [vectorStr, maxDistance, fileId, topK]
      : [vectorStr, maxDistance, topK]
  );
  return attachDistance(rows);
}
