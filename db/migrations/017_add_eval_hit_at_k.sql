-- Keep recall_at_k unchanged: historical scores include out-of-scope cases.
-- No backfill: those scores are not answerable-only Hit@K.
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS hit_at_k jsonb;
