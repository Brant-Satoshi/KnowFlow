# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm dev          # start dev server (localhost:3000)
pnpm build        # production build + type-check
pnpm lint         # ESLint
```

No test runner is configured. Use `pnpm build` to catch type errors.

## Architecture

Next.js App Router RAG chat app. PostgreSQL + pgvector for vector storage.

**Routes (do not add others)**
- `/` — Knowledge Base list (CRUD)
- `/knowledge-bases/[id]/chat` — RAG chat scoped to a KB
- `/eval` — evaluation
- `/login`, `/register` — authentication

**RAG pipeline** (per chat request at `app/api/chat/stream/route.ts`):
1. Embed the user query → `lib/rag/embeddings.ts` (`embedText`)
2. Vector search top-20 chunks with cosine distance < 0.4 → `lib/db/chunks.ts` (`searchChunks`)
3. Rerank via OpenRouter/Cohere → `lib/rag/rerank.ts` (`rerankChunks`), take top-5
4. Build prompt → `lib/llm/chat.ts` (`buildPrompt`)
5. Stream answer from MiniMax → `lib/llm/chat.ts` (`streamAnswer`), returned as SSE

**SSE event types** (`meta` → `token`+ → `done` | `error`). All carry `requestId`.

**Database schema** (9 tables). Drizzle models live in `lib/db/schema/*.ts` (`core.ts`, `eval.ts`) for ORM type inference only; handwritten `db/migrations/00x_*.sql` is the source of truth, applied via `make migrate` (drizzle-kit does **not** generate migrations — see `drizzle.config.ts`).

Core (`schema/core.ts`):
- `knowledge_bases` — id, name, description
- `files` — id, name, type, size, status, knowledge_base_id (FK)
- `chunks` — id, file_id (FK), idx, text, meta jsonb, embedding vector(1536)
- `conversations` — id, knowledge_base_id (FK), title, model
- `messages` — id, conversation_id (FK), role, content, retrieved_chunks jsonb

Eval (`schema/eval.ts`):
- `eval_datasets` — id, name (unique), dataset_hash, case_count
- `eval_cases` — id, dataset_id (FK), case_key, question, expected_keywords, category, difficulty
- `eval_runs` — id, knowledge_base_id (FK), dataset_id (FK), mode, use_rerank, retrieval/citation hit rates, recall/precision/ndcg/mrr
- `eval_run_items` — id, run_id (FK), case_key, passed, retrieval_hit, citation_hit, retrieved_chunks

HNSW index on `chunks.embedding` for fast cosine search.

**Adding a table**: define it in `lib/db/schema/*.ts`, handwrite `db/migrations/00x_*.sql`, add that file to the `migrate` target in `Makefile`, then add a query module in `lib/db/`.

**External services**
- LLM: OpenRouter (`OPENROUTER_API_KEY`). Model catalog is in `lib/llm/catalog.ts` — UI lets users pick per conversation; selected id is persisted on `conversations.model`. Default is the first catalog entry.
- Embeddings: OpenRouter (`OPENROUTER_API_KEY`). Model from `OPENROUTER_EMBEDDING_MODEL` (default `text-embedding-3-small`). Vectors must be 1536-dimensional; override with `OPENROUTER_EMBEDDING_DIMENSIONS` only if you understand the DB schema constraint.
- Reranking: OpenRouter (`OPENROUTER_API_KEY`) — model `cohere/rerank-v3.5`. Disabled by `RERANK_ENABLED=false`.

## Key Patterns

**API response shape** — all endpoints must return via `lib/api/response.ts`:
```typescript
{ requestId: string, ok: boolean, data?, error? }
```
Use `success(data)` and `error(message)` from `@/lib/api/response.ts`.  
`requestId` is generated fresh per call via `lib/telemetry/requestId.ts`.

**Shared types** — `lib/types.ts`: `Message`, `Conversation` (now includes `model: string | null`), `KnowledgeBase`, `FileDoc`, `Chunk`, `Citation`.

## i18n

All user-visible strings must use the translation system — no hardcoded English or Chinese text in JSX or `aria-label`.

- Translation files: `lib/i18n/translations.ts` — two top-level sections: `home` (accessed via `home: t = useLanguage()`) and `chat` (accessed via `t = useLanguage()`).
- Add keys to **both** `en` and `zh` when introducing new strings.
- For parameterised strings use a `{placeholder}` convention and replace at call site (e.g. `t.noResults.replace("{query}", searchQuery)`).
- Sub-components that render text must receive `t` as a prop (typed `ReturnType<typeof useLanguage>["home" | "chat"]`) rather than calling `useLanguage()` themselves, unless they are already client components with clear ownership.

## Frontend Conventions

- Interactive elements (`button`, `a`, clickable `div`s) must include `cursor-pointer`.

## Constraints

- Do not add new top-level routes beyond the pages listed above
- Do not add new npm dependencies without asking
- Every change must be runnable without additional setup
- Do not change database schema or API response shape unless explicitly requested
