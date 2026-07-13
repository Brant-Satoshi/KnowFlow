-- Review fix (PR #45): dataset_hash covers case content only, so metadata
-- writes (rename/description) never changed the optimistic-concurrency token
-- and could silently overwrite each other. A monotonic revision, bumped on
-- every dataset write, becomes the concurrency token; dataset_hash stays a
-- pure content identity so historical run comparability is untouched.
ALTER TABLE eval_datasets ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
