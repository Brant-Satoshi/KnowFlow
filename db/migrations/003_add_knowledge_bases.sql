-- 003_add_knowledge_bases.sql

-- 1. 创建 knowledge_bases 表
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. 给 files 表增加 knowledge_base_id
ALTER TABLE files
ADD COLUMN IF NOT EXISTS knowledge_base_id uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE;

-- 3. 确保存在默认知识库，并迁移历史文件
DO $$
DECLARE
  default_kb_id uuid;
BEGIN
  SELECT id INTO default_kb_id
  FROM knowledge_bases
  WHERE name = 'Default Knowledge Base'
  LIMIT 1;

  IF default_kb_id IS NULL THEN
    INSERT INTO knowledge_bases (name, description)
    VALUES ('Default Knowledge Base', 'Default knowledge base for existing files')
    RETURNING id INTO default_kb_id;
  END IF;

  UPDATE files
  SET knowledge_base_id = default_kb_id
  WHERE knowledge_base_id IS NULL;
END $$;

-- 4. 收紧约束
ALTER TABLE files
ALTER COLUMN knowledge_base_id SET NOT NULL;

-- 5. 索引
CREATE INDEX IF NOT EXISTS files_kb_idx ON files(knowledge_base_id);
CREATE INDEX IF NOT EXISTS kb_created_idx ON knowledge_bases(created_at DESC);