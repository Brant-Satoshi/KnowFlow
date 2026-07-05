# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
pnpm dev          # start dev server (localhost:3000)
pnpm build        # production build + type-check
pnpm lint         # ESLint
pnpm test:e2e     # Playwright end-to-end tests
```

No unit test runner is configured. Use `pnpm build` to catch type errors.

## Architecture

Next.js App Router RAG chat app. PostgreSQL + pgvector for vector storage.

**Routes (do not add others)**
- `/` — home: Knowledge Base list (CRUD), workspace switcher / members / join dialogs
- `/knowledge-bases/[id]/chat` — RAG chat scoped to a KB
- `/eval` — evaluation
- `/login`, `/register` — authentication

**Auth & multi-tenancy**
- Session-cookie auth: `lib/auth/*` (sessions, cookie, password, current-user); endpoints under `/api/auth/*` (register/login/logout/me).
- Every knowledge base belongs to a workspace. Access is enforced by the guards in `lib/authz/access.ts` (`requireKnowledgeBaseAccess`, `requireConversationAccess`, `requireFileAccess`, `requireEvalRunAccess`, `requireWorkspaceRole`) — every API route touching KB-scoped data must go through them; cross-tenant access returns 404, anonymous 401.
- Workspace membership/invite/join/leave endpoints live under `/api/workspaces/*`. Roles: owner / admin / member (each workspace has exactly one owner).

**RAG pipeline** (per chat request at `app/api/chat/stream/route.ts`; retrieval stages shared with the eval runner via `lib/rag/retrieve.ts`, params centralized in its exported `RETRIEVAL` config):
1. Embed the user query + vector search top-20 chunks with cosine distance < 0.6, optionally narrowed by a `RetrievalFilter` (`fileIds` / `fileTypes` / `titleQuery`; type in `lib/types.ts`, parsed via `parseRetrievalFilter` in `lib/validation.ts`) → `lib/rag/retrieve.ts` (`recallChunks`)
2. Rerank via OpenRouter/Cohere (topN 8), then take top-5 → `lib/rag/retrieve.ts` (`selectFinalChunks`)
3. Build prompt → `lib/llm/chat.ts` (`buildPrompt`)
4. Stream answer via OpenRouter → `lib/llm/chat.ts` (`streamLlmAnswer`), returned as SSE

The same `RetrievalFilter` is accepted by `/api/rag/search` and `/api/eval/run`.

**SSE event types**: `progress` (stages: searching → searched → reranking → reranked → generating) interleaved with `meta` → `token`+ → `done` | `error`; plus `title` when a conversation title is auto-generated. All carry `requestId`.

**Database schema** (14 tables). Drizzle models live in `lib/db/schema/*.ts` (`core.ts`, `eval.ts`, `auth.ts`) for ORM type inference only; handwritten `db/migrations/0xx_*.sql` is the source of truth, applied via `make migrate` (local Docker) or `make migrate-supabase` (remote Postgres via `DATABASE_URL`); drizzle-kit does **not** generate migrations — see `drizzle.config.ts`.

Auth (`schema/auth.ts`):
- `users` — id, email, password_hash
- `sessions` — id (token), user_id (FK), expires_at
- `workspaces` — id, name, owner_id (FK)
- `workspace_members` — workspace_id (FK), user_id (FK), role
- `workspace_invites` — id, workspace_id (FK), role, token, created_by (FK), expires_at

Core (`schema/core.ts`):
- `knowledge_bases` — id, user_id (FK), workspace_id (FK), name, description
- `files` — id, name, type, size, status, knowledge_base_id (FK)
- `chunks` — id, file_id (FK), idx, text, embedding_text, document_title, section_title, meta jsonb, embedding vector(1536)
- `conversations` — id, knowledge_base_id (FK), title, model
- `messages` — id, conversation_id (FK), role, content, retrieved_chunks jsonb

Eval (`schema/eval.ts`):
- `eval_datasets` — id, name (unique), dataset_hash, case_count
- `eval_cases` — id, dataset_id (FK), case_key, question, expected_keywords, category, difficulty, target_file_names, target_chunk_substrings
- `eval_runs` — id, knowledge_base_id (FK), dataset_id (FK), mode, use_rerank, retrieval/citation hit rates, recall/precision/ndcg/mrr, LLM-judge metrics (avg_faithfulness, avg_answer_relevance), filter jsonb
- `eval_run_items` — id, run_id (FK), case_key, passed, retrieval_hit, citation_hit, retrieved_chunks, faithfulness, answer_relevance

HNSW index on `chunks.embedding` for fast cosine search.

**Adding a table**: define it in `lib/db/schema/*.ts`, handwrite `db/migrations/0xx_*.sql`, add that file to both the `migrate` and `migrate-supabase` targets in `Makefile`, then add a query module in `lib/db/`.

**External services**
- LLM: OpenRouter (`OPENROUTER_API_KEY`). Model catalog is in `lib/llm/catalog.ts` — UI lets users pick per conversation; selected id is persisted on `conversations.model`. Default is the first catalog entry.
- Embeddings: OpenRouter (`OPENROUTER_API_KEY`). Model from `OPENROUTER_EMBEDDING_MODEL` (default `text-embedding-3-small`). Vectors must be 1536-dimensional; override with `OPENROUTER_EMBEDDING_DIMENSIONS` only if you understand the DB schema constraint.
- Reranking: OpenRouter (`OPENROUTER_API_KEY`) — model `cohere/rerank-v3.5`. Disabled by `RERANK_ENABLED=false`.
- File storage: Supabase Storage (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — client in `lib/db/supabase.ts`, helpers in `lib/db/storage.ts`, bucket `files`.

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

- Translation files: `lib/i18n/translations.ts` — four top-level sections per language: `home`, `chat`, `eval`, `auth`. `useLanguage()` exposes them as `{ home, t (= chat), evalT, authT }`.
- Add keys to **both** `en` and `zh` when introducing new strings.
- For parameterised strings use a `{placeholder}` convention and replace at call site (e.g. `t.noResults.replace("{query}", searchQuery)`).
- Sub-components that render text must receive `t` as a prop (typed `ReturnType<typeof useLanguage>["home" | "t" | "evalT" | "authT"]`) rather than calling `useLanguage()` themselves, unless they are already client components with clear ownership.

## Frontend Conventions

- Interactive elements (`button`, `a`, clickable `div`s) must include `cursor-pointer`.
- UI components: shadcn/ui only (Button, Dialog, Input, Card, DropdownMenu, …) with lucide-react icons — no MUI / antd / inline CSS.
- Colors: use Tailwind semantic tokens (`bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`, `bg-card`, `bg-muted`) — never raw palette classes like `text-gray-800`, `bg-white`, `text-black`.

## Constraints

- Do not add new top-level routes beyond the pages listed above
- Do not add new npm dependencies without asking
- Every change must be runnable without additional setup
- Do not change database schema or API response shape unless explicitly requested
