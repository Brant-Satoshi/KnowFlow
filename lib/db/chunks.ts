import { Chunk, RetrievalFileType, RetrievalFilter } from '@/lib/types';
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

const FILE_TYPE_EXTENSIONS: Record<RetrievalFileType, string[]> = {
  pdf: ['.pdf'],
  markdown: ['.md'],
  word: ['.doc', '.docx'],
  text: ['.txt'],
};

/** Escape LIKE wildcards so user input matches literally (default escape char is backslash). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export async function searchChunks(
  queryEmbedding: number[],
  topK: number = 5,
  maxDistance: number = 0.4,
  fileId?: string,
  knowledgeBaseId?: string,
  filter?: RetrievalFilter,
): Promise<Chunk[]> {
  const vectorStr = `[${queryEmbedding.join(',')}]`;
  const hasFilter = Boolean(
    filter?.fileIds?.length || filter?.fileTypes?.length || filter?.titleQuery,
  );

  const params: unknown[] = [vectorStr, maxDistance];
  const where = ['c.embedding IS NOT NULL', 'c.embedding <=> $1::vector < $2'];

  if (knowledgeBaseId) {
    params.push(knowledgeBaseId);
    where.push(`f.knowledge_base_id = $${params.length}::uuid`);
  }
  if (fileId) {
    params.push(fileId);
    where.push(`c.file_id = $${params.length}`);
  }
  // fileIds intersects with fileId when both are given (possibly empty result).
  if (filter?.fileIds?.length) {
    params.push(filter.fileIds);
    where.push(`c.file_id = ANY($${params.length}::uuid[])`);
  }
  if (filter?.fileTypes?.length) {
    params.push(filter.fileTypes.flatMap(t => FILE_TYPE_EXTENSIONS[t].map(ext => `%${ext}`)));
    where.push(`f.name ILIKE ANY($${params.length})`);
  }
  if (filter?.titleQuery) {
    params.push(`%${escapeLike(filter.titleQuery)}%`);
    where.push(
      `(c.document_title ILIKE $${params.length} OR c.section_title ILIKE $${params.length})`
    );
  }
  params.push(topK);

  const sql = `
    SELECT c.id::text, c.file_id AS "fileId", c.idx, c.text,
           c.embedding_text AS "embeddingText", c.document_title AS "documentTitle",
           c.section_title AS "sectionTitle", c.meta, f.name AS "fileName",
           c.embedding <=> $1::vector AS distance
    FROM chunks c
    JOIN files f ON c.file_id = f.id::uuid
    WHERE ${where.join('\n    AND ')}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $${params.length}
    `;

  if (!hasFilter) {
    return attachDistance(await query<ChunkWithDistance>(sql, params));
  }

  // Filtered search must be exact: pgvector post-filters the hnsw.ef_search
  // (default 40) HNSW candidates, so a selective filter (e.g. one small file)
  // could silently drop matches outside that window. Disabling index scans for
  // this query forces an exact scan over the filtered rows — cheap at the
  // per-KB corpus sizes here. Revisit with pgvector 0.8 iterative scans if
  // filtered KBs grow large.
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_indexscan = off');
    const result = await client.query<ChunkWithDistance>(sql, params);
    await client.query('COMMIT');
    return attachDistance(result.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
