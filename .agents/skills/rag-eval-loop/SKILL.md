---
name: rag-eval-loop
description: Evaluate KnowFlow changes that affect retrieval or answer quality; excludes behavior-preserving refactors.
---

# RAG changes with evidence

Chat and eval share `recallChunks` and `selectFinalChunks` in `lib/rag/retrieve.ts`; tuning belongs in its `RETRIEVAL` config. Prompt assembly is in `lib/llm/chat.ts`, with chunking and embeddings in `lib/rag/`.

For quality-affecting changes, capture a baseline and compare the changed version on the same corpus, dataset, filters, and model settings, varying only the intended factor. Use `lib/eval/runner.ts` through the eval page/API, or `pnpm eval:hybrid-ab` for vector versus hybrid. Report relevant metric deltas and regressions; if data or service access is unavailable, state that quality is unmeasured.

- Changed chunking or embedding text requires rebuilding affected indexed data before comparison. `scripts/reembed.ts` handles re-embedding; inspect its supported scope before use.
- Embeddings must match the database's 1536 dimensions. Model/dimension changes require a compatible migration and re-indexing plan within the authorized scope.
- Preserve fallback behavior with `RERANK_ENABLED=false`.
- Hybrid recall remains gated by `HYBRID_SEARCH_ENABLED`. A default change requires a same-corpus vector-versus-hybrid comparison; consult [ADR-010](../../../docs/adr/010.hybrid-search-rrf-gated.md).

Evaluation and re-indexing can call paid services and write data. Use the authorized dataset/environment; evaluation does not authorize re-indexing unrelated knowledge bases.
