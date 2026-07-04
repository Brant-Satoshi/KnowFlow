-- Retrieval filter applied to an eval run (per-run, UI-configured).
-- NULL means the run was unfiltered, so existing rows stay correct; idempotent for re-runs.
ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS filter jsonb;
