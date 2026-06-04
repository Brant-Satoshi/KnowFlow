import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('kb_created_idx').on(table.createdAt.desc()),
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
    meta: jsonb('meta').notNull().default({}),
    embedding: vector('embedding', { dimensions: 1536 }),
  },
  (table) => [
    index('chunks_file_idx').on(table.fileId, table.idx),
    index('chunks_embedding_hnsw').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
);