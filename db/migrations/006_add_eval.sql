CREATE TABLE IF NOT EXISTS eval_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  dataset_hash text NOT NULL,
  case_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS eval_datasets_name_unique
  ON eval_datasets(name);

CREATE TABLE IF NOT EXISTS eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES eval_datasets(id) ON DELETE CASCADE,
  case_key text NOT NULL,
  question text NOT NULL,
  expected_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text NOT NULL,
  difficulty text NOT NULL,
  target_file_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_chunk_substrings jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_answer text,
  notes text,
  idx integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS eval_cases_dataset_idx
  ON eval_cases(dataset_id, idx);

CREATE TABLE IF NOT EXISTS eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  dataset_id uuid REFERENCES eval_datasets(id) ON DELETE SET NULL,
  dataset_name text,
  dataset_hash text,
  mode text NOT NULL,
  use_rerank boolean NOT NULL,
  total_cases integer NOT NULL,
  passed_cases integer NOT NULL,
  retrieval_hit_rate double precision NOT NULL,
  citation_hit_rate double precision NOT NULL,
  avg_latency_ms integer NOT NULL,
  recall_at_k jsonb,
  precision_at_k jsonb,
  ndcg_at_k jsonb,
  mrr double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eval_runs_kb_idx
  ON eval_runs(knowledge_base_id, created_at DESC);

CREATE INDEX IF NOT EXISTS eval_runs_hash_idx
  ON eval_runs(knowledge_base_id, dataset_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS eval_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  case_key text NOT NULL,
  question text NOT NULL,
  passed boolean NOT NULL,
  failure_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  retrieval_hit boolean NOT NULL,
  citation_hit boolean NOT NULL,
  latency_ms integer NOT NULL,
  retrieved_chunks jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_k_hits jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer text NOT NULL DEFAULT '',
  expected_answer text,
  graded_hits jsonb
);

CREATE INDEX IF NOT EXISTS eval_run_items_run_idx
  ON eval_run_items(run_id, idx);