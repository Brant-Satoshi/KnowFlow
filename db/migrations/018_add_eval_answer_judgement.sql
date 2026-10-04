-- Per-answer judgement; historical rows remain NULL because they were not graded.
-- Skip existing columns when this migration is applied again.
ALTER TABLE eval_run_items
  ADD COLUMN IF NOT EXISTS answer_verdict text
    CONSTRAINT eval_run_items_answer_verdict_check
    CHECK (answer_verdict IN ('pass', 'fail', 'unscored')),
  ADD COLUMN IF NOT EXISTS answer_reason text;
