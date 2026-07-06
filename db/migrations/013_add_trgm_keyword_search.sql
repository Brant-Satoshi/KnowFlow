-- Keyword retrieval leg (trigram) over embedding_text: word_similarity()
-- matches short queries against long chunks and is language-agnostic, which
-- the mixed zh/en corpus requires (built-in FTS cannot tokenize Chinese).
-- embedding_text is the same representation the vector leg embeds, so both
-- retrieval paths search one consistent surface.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CONCURRENTLY: chunks already holds data on the remote DB and a plain
-- CREATE INDEX would block writes. Both migration runners apply statements
-- outside a transaction, so this is safe. If a concurrent build fails it
-- leaves an INVALID index that IF NOT EXISTS then skips — check pg_index
-- .indisvalid after migrating and DROP INDEX + re-run if needed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS chunks_embedding_text_trgm
  ON chunks USING gin (embedding_text gin_trgm_ops);
