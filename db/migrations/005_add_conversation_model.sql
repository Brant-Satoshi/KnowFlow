-- 005_add_conversation_model.sql

-- Nullable: NULL means "use catalog default" (see lib/llm/catalog.ts).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model text;
