-- Managed eval datasets: user-editable goldsets need (dataset_id, case_key)
-- uniqueness before the CRUD API can rely on it.

-- Healing: 006 defines expected_answer/notes, but earlier deployments may have
-- applied a pre-expansion copy of it. No-op wherever 006 already created them.
ALTER TABLE eval_cases ADD COLUMN IF NOT EXISTS expected_answer text;
ALTER TABLE eval_cases ADD COLUMN IF NOT EXISTS notes text;

-- Audit before the unique index: fail with the offending rows spelled out
-- instead of a bare unique-index build error.
DO $$
DECLARE
  dup record;
BEGIN
  SELECT dataset_id, case_key, count(*) AS n
    INTO dup
    FROM eval_cases
   GROUP BY dataset_id, case_key
  HAVING count(*) > 1
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'eval_cases contains duplicate case_key "%" in dataset % (% rows). Deduplicate these rows, then re-run this migration to apply eval_cases_dataset_case_key_unique.',
      dup.case_key, dup.dataset_id, dup.n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS eval_cases_dataset_case_key_unique
  ON eval_cases(dataset_id, case_key);
