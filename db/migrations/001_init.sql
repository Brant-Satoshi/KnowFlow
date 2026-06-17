CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  size int NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL default now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id text PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  idx int NOT NULL,
  text text NOT NULL,
  embedding vector(1536) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_file_idx ON chunks(file_id, idx);
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
