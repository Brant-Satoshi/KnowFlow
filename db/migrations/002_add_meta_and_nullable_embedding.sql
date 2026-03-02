CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE chunks
  ALTER COLUMN embedding DROP NOT NULL;

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS chunks_file_idx
  ON chunks(file_id, idx);

CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops);