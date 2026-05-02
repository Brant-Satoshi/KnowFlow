-- 004_add_conversations.sql

-- 1. conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  retrieved_chunks jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. indexes
CREATE INDEX IF NOT EXISTS conversations_kb_idx
  ON conversations(knowledge_base_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS messages_conv_created_idx
  ON messages(conversation_id, created_at);
