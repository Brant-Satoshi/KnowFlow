-- Keyword retrieval leg (trigram) over embedding_text: word_similarity()
-- matches short queries against long chunks and is language-agnostic, which
-- the mixed zh/en corpus requires (built-in FTS cannot tokenize Chinese).
-- embedding_text is the same representation the vector leg embeds, so both
-- retrieval paths search one consistent surface.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CONCURRENTLY: chunks already holds data on the remote DB and a plain
-- CREATE INDEX would block writes. Both migration runners apply statements
-- outside a transaction, so this is safe on a session/direct connection.
--
-- Through a Supabase *transaction* pooler (:6543) CONCURRENTLY cannot keep one
-- session across its build phases: it may error, or leave an INVALID index that
-- the IF NOT EXISTS then silently skips on the natural re-run — shipping
-- keyword/hybrid search with no usable index. Apply over the session pooler
-- (:5432) or the direct connection.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chunks_embedding_text_trgm
  ON chunks USING gin (embedding_text gin_trgm_ops);

-- Fail loudly (under psql ON_ERROR_STOP, as migrate-supabase runs) if the index
-- above is missing or INVALID, instead of letting the migration "succeed" while
-- the feature silently falls back to sequential scans. Runs as its own
-- autocommit statement, so it never wraps the CONCURRENTLY build in a txn.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'chunks_embedding_text_trgm' AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'chunks_embedding_text_trgm is missing or INVALID: CREATE INDEX CONCURRENTLY did not complete (a transaction pooler cannot run it). Run "DROP INDEX IF EXISTS chunks_embedding_text_trgm;" then re-apply this migration over the session pooler (:5432) or the direct connection.';
  END IF;
END $$;
