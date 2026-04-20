import { KnowledgeBase } from '@/lib/types';
import { query } from './pg';

const KB_SELECT = `
  id::text,
  name,
  description,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export const DEFAULT_KB_NAME = 'Default Knowledge Base';

export type KnowledgeBaseDeleteFile = {
  id: string;
  name: string;
  knowledgeBaseId: string;
};

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return query<KnowledgeBase>(
    `SELECT ${KB_SELECT} FROM knowledge_bases ORDER BY created_at DESC;`
  );
}

export async function getKnowledgeBaseById(id: string): Promise<KnowledgeBase | undefined> {
  const rows = await query<KnowledgeBase>(
    `SELECT ${KB_SELECT} FROM knowledge_bases WHERE id = $1::uuid LIMIT 1;`,
    [id]
  );
  return rows[0];
}

export async function getKnowledgeBaseByName(name: string): Promise<KnowledgeBase | undefined> {
  const rows = await query<KnowledgeBase>(
    `SELECT ${KB_SELECT} FROM knowledge_bases WHERE name = $1 LIMIT 1;`,
    [name]
  );
  return rows[0];
}

export async function getDefaultKnowledgeBase(): Promise<KnowledgeBase | undefined> {
  return getKnowledgeBaseByName(DEFAULT_KB_NAME);
}

export async function createKnowledgeBase(
  name: string,
  description?: string
): Promise<KnowledgeBase> {
  const rows = await query<KnowledgeBase>(
    `
    INSERT INTO knowledge_bases (name, description)
    VALUES ($1, $2)
    RETURNING ${KB_SELECT};
    `,
    [name, description ?? null]
  );
  return rows[0];
}

export type UpdateKnowledgeBaseInput = {
  name?: string;
  description?: string;
};

export async function updateKnowledgeBase(
  id: string,
  data: UpdateKnowledgeBaseInput
): Promise<KnowledgeBase | undefined> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(data.name);
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    values.push(data.description ?? null);
  }

  if (updates.length === 0) {
    return getKnowledgeBaseById(id);
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  const rows = await query<KnowledgeBase>(
    `
    UPDATE knowledge_bases
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex}::uuid
    RETURNING ${KB_SELECT};
    `,
    values
  );
  return rows[0];
}

export async function listKnowledgeBaseDeleteFiles(
  knowledgeBaseId: string
): Promise<KnowledgeBaseDeleteFile[]> {
  return query<KnowledgeBaseDeleteFile>(
    `
    SELECT
      id::text,
      name,
      knowledge_base_id AS "knowledgeBaseId"
    FROM files
    WHERE knowledge_base_id = $1::uuid
    ORDER BY created_at DESC;
    `,
    [knowledgeBaseId]
  );
}

export async function deleteKnowledgeBase(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM knowledge_bases WHERE id = $1::uuid RETURNING id::text AS "id";`,
    [id]
  );
  return rows.length > 0;
}
