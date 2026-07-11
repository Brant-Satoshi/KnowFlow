---
name: rag-eval-loop
description: Change the RAG retrieval pipeline (recall, rerank, filters, chunking, embeddings, prompt) with a measured before/after. Use for any change to lib/rag/*, lib/llm/chat.ts prompt building, or retrieval params — retrieval quality claims must be backed by the built-in eval, not vibes.
---

# RAG change + eval loop

Retrieval changes are easy to make and hard to judge by eye. This repo has a built-in eval harness precisely so that "feels better" never justifies a pipeline change.

## Where things live

- Retrieval stages: `lib/rag/retrieve.ts` — `recallChunks` (embed query → pgvector top-20, cosine distance < 0.6, optional `RetrievalFilter`) then `selectFinalChunks` (Cohere rerank topN 8 → top-5). **Shared by chat and the eval runner** — change it once here, both paths move.
- All tunable params: the exported `RETRIEVAL` config in `lib/rag/retrieve.ts`. Change numbers there, not inline.
- Prompt assembly: `buildPrompt` in `lib/llm/chat.ts`.
- Chunking/embedding: `lib/rag/chunks.ts`, `lib/rag/embeddings.ts`; re-embedding script: `scripts/reembed.ts` (needed if you change embedding text construction — contextual embeddings live in `embedding_text`).
- Eval runner: `lib/eval/runner.ts`, driven from the `/eval` page or `POST /api/eval/run` (accepts the same `RetrievalFilter`).

## Procedure

1. **Baseline first.** Run the eval on the target dataset/KB *before* touching anything. Record: retrieval hit rate, citation hit rate, recall, precision, nDCG, MRR (and faithfulness/answer-relevance if judging). Use `mode` and `use_rerank` to isolate the stage you're changing.
2. Make the change. If it touches recall or rerank, keep it inside `recallChunks`/`selectFinalChunks` so chat and eval stay in lockstep; if it's a knob, put it in `RETRIEVAL`.
3. If embedding text changed, re-embed affected KBs with `scripts/reembed.ts` before re-running eval — otherwise you're measuring stale vectors.
4. **Re-run the same eval** (same dataset, same filter, same rerank setting). Compare metric by metric.
5. Report the delta table in the final summary. A regression on nDCG/MRR is a finding to surface, not something to bury under "answers look good".

## Cautions

- Rerank can be disabled via `RERANK_ENABLED=false` — verify graceful degradation to pure vector ordering still works after your change.
- Vectors are fixed at 1536 dims (DB column type). Changing embedding model/dimensions is a schema-level decision — stop and ask.
- Hybrid retrieval (pg_trgm keyword leg + RRF fusion) is landed but gated off by `HYBRID_SEARCH_ENABLED` — the eval found it neutral-to-negative on the current dataset (ADR-010). Don't flip the default on without re-running the vector-vs-hybrid comparison (`RunCuratedEvalOpts.retrievalMode`) on the target dataset. Don't add new retrieval dependencies unilaterally.
