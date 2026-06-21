-- Contextual retrieval: store a context-enriched text per chunk (document +
-- section titles + body) that is embedded/reranked instead of the raw text.
-- Display, prompt context and citations keep using chunks.text.

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_text text,
  ADD COLUMN IF NOT EXISTS document_title text,
  ADD COLUMN IF NOT EXISTS section_title text;

-- Existing rows were embedded from text; keep embedding_text consistent with
-- the stored vector until the files are re-ingested (pnpm reembed).
UPDATE chunks SET embedding_text = text WHERE embedding_text IS NULL;

ALTER TABLE chunks ALTER COLUMN embedding_text SET NOT NULL;
