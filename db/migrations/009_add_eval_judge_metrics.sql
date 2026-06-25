-- LLM-judge metrics for curated eval runs: faithfulness + answer relevance.
-- Run-level averages on eval_runs, per-case scores on eval_run_items.
-- Nullable so existing (pre-judge) runs are unaffected; idempotent for re-runs.

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS avg_faithfulness double precision,
  ADD COLUMN IF NOT EXISTS avg_answer_relevance double precision;

ALTER TABLE eval_run_items
  ADD COLUMN IF NOT EXISTS faithfulness double precision,
  ADD COLUMN IF NOT EXISTS answer_relevance double precision;
