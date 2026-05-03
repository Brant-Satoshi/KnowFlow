import {
  ConversationSummary,
  ConversationWithMessages,
  RetrievedChunk,
  StoredMessage,
} from '@/lib/types';
import { query, execute } from './pg';

const CONVERSATION_SELECT = `
  id::text,
  knowledge_base_id::text AS "knowledgeBaseId",
  title,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const MESSAGE_SELECT = `
  id::text,
  conversation_id::text AS "conversationId",
  role,
  content,
  retrieved_chunks AS "retrievedChunks",
  created_at AS "createdAt"
`;

export const DEFAULT_CONVERSATION_TITLE = 'New chat';

export async function listConversations(
  knowledgeBaseId: string
): Promise<ConversationSummary[]> {
  return query<ConversationSummary>(
    `SELECT ${CONVERSATION_SELECT}
     FROM conversations
     WHERE knowledge_base_id = $1::uuid
     ORDER BY updated_at DESC;`,
    [knowledgeBaseId]
  );
}

export async function getConversationById(
  id: string
): Promise<ConversationSummary | undefined> {
  const rows = await query<ConversationSummary>(
    `SELECT ${CONVERSATION_SELECT}
     FROM conversations
     WHERE id = $1::uuid
     LIMIT 1;`,
    [id]
  );
  return rows[0];
}

export async function getConversationWithMessages(
  id: string
): Promise<ConversationWithMessages | undefined> {
  const conversation = await getConversationById(id);
  if (!conversation) return undefined;

  const messages = await query<StoredMessage>(
    `SELECT ${MESSAGE_SELECT}
     FROM messages
     WHERE conversation_id = $1::uuid
     ORDER BY created_at ASC, id ASC;`,
    [id]
  );

  return { ...conversation, messages };
}

export async function createConversation(
  knowledgeBaseId: string,
  title?: string
): Promise<ConversationSummary> {
  const rows = await query<ConversationSummary>(
    `INSERT INTO conversations (knowledge_base_id, title)
     VALUES ($1::uuid, $2)
     RETURNING ${CONVERSATION_SELECT};`,
    [knowledgeBaseId, title?.trim() ? title.trim() : DEFAULT_CONVERSATION_TITLE]
  );
  return rows[0];
}

export async function updateConversationTitle(
  id: string,
  title: string
): Promise<ConversationSummary | undefined> {
  const rows = await query<ConversationSummary>(
    `UPDATE conversations
     SET title = $2, updated_at = now()
     WHERE id = $1::uuid
     RETURNING ${CONVERSATION_SELECT};`,
    [id, title]
  );
  return rows[0];
}

export async function touchConversation(id: string): Promise<void> {
  await execute(
    `UPDATE conversations SET updated_at = now() WHERE id = $1::uuid;`,
    [id]
  );
}

export async function deleteConversation(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM conversations WHERE id = $1::uuid RETURNING id::text AS "id";`,
    [id]
  );
  return rows.length > 0;
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  retrievedChunks?: RetrievedChunk[],
  id?: string,
): Promise<StoredMessage> {
  const chunks =
    retrievedChunks && retrievedChunks.length > 0
      ? JSON.stringify(retrievedChunks)
      : null;

  if (id) {
    const rows = await query<StoredMessage>(
      `INSERT INTO messages (id, conversation_id, role, content, retrieved_chunks)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
       RETURNING ${MESSAGE_SELECT};`,
      [id, conversationId, role, content, chunks]
    );
    return rows[0];
  }

  const rows = await query<StoredMessage>(
    `INSERT INTO messages (conversation_id, role, content, retrieved_chunks)
     VALUES ($1::uuid, $2, $3, $4::jsonb)
     RETURNING ${MESSAGE_SELECT};`,
    [conversationId, role, content, chunks]
  );
  return rows[0];
}

export async function deleteMessages(
  conversationId: string,
  messageIds: string[],
): Promise<number> {
  if (messageIds.length === 0) return 0;
  return execute(
    `DELETE FROM messages
     WHERE conversation_id = $1::uuid
     AND id = ANY($2::uuid[]);`,
    [conversationId, messageIds]
  );
}

export async function listRecentMessages(
  conversationId: string,
  limit: number
): Promise<StoredMessage[]> {
  const rows = await query<StoredMessage>(
    `SELECT ${MESSAGE_SELECT}
     FROM messages
     WHERE conversation_id = $1::uuid
     ORDER BY created_at DESC, id DESC
     LIMIT $2;`,
    [conversationId, limit]
  );
  return rows.reverse();
}
