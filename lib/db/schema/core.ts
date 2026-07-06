import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users, workspaces } from './auth';

export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('kb_created_idx').on(table.createdAt.desc()),
    index('kb_user_idx').on(table.userId),
    index('kb_workspace_idx').on(table.workspaceId),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('files_kb_idx').on(table.knowledgeBaseId),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: text('id').primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    embeddingText: text('embedding_text').notNull(),
    documentTitle: text('document_title'),
    sectionTitle: text('section_title'),
    meta: jsonb('meta').notNull().default({}),
    embedding: vector('embedding', { dimensions: 1536 }),
  },
  (table) => [
    index('chunks_file_idx').on(table.fileId, table.idx),
    index('chunks_embedding_hnsw').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    index('chunks_embedding_text_trgm').using(
      'gin',
      table.embeddingText.op('gin_trgm_ops'),
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    knowledgeBaseId: uuid('knowledge_base_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('conversations_kb_idx').on(table.knowledgeBaseId, table.updatedAt.desc()),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    retrievedChunks: jsonb('retrieved_chunks').$type<unknown[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_conv_created_idx').on(table.conversationId, table.createdAt),
    check('messages_role_check', sql`${table.role} in ('user', 'assistant')`),
  ],
);
