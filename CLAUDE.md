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

**RAG pipeline** (per chat request at `app/api/chat/stream/route.ts`):
1. Embed the user query → `lib/rag/embeddings.ts` (`embedText`)
2. Vector search top-20 chunks with cosine distance < 0.4 → `lib/db/chunks.ts` (`searchChunks`)
3. Rerank via OpenRouter/Cohere → `lib/rag/rerank.ts` (`rerankChunks`), take top-5
4. Build prompt → `lib/llm/chat.ts` (`buildPrompt`)
5. Stream answer from MiniMax → `lib/llm/chat.ts` (`streamAnswer`), returned as SSE

**SSE event types** (`meta` → `token`+ → `done` | `error`). All carry `requestId`.

**Database schema** (3 tables):
- `knowledge_bases` — id, name, description
- `files` — id, name, type, size, status, knowledge_base_id (FK)
- `chunks` — id, file_id (FK), idx, text, embedding vector(1536)

HNSW index on `chunks.embedding` for fast cosine search.

**External services**
- LLM: MiniMax (`MINIMAX_API_KEY`) — model `abab6.5-chat`
- Embeddings: MiniMax or OpenAI-compatible, toggled by env vars (`MINIMAX_EMBEDDING_MODEL` vs `OPENAI_EMBEDDING_MODEL`). Vectors must be 1536-dimensional.
- Reranking: OpenRouter (`OPENROUTER_API_KEY`) — model `cohere/rerank-v3.5`. Disabled by `RERANK_ENABLED=false`.

## Key Patterns

**API response shape** — all endpoints must return via `lib/api/response.ts`:
```typescript
{ requestId: string, ok: boolean, data?, error? }
```
Use `success(data)` and `error(message)` from `@/lib/api/response.ts`.  
`requestId` is generated fresh per call via `lib/telemetry/requestId.ts`.

**Shared types** — `lib/types.ts`: `Message`, `Conversation`, `KnowledgeBase`, `FileDoc`, `Chunk`, `Citation`.

## Constraints

- Do not add new top-level routes (pages are fixed to the three above)
- Do not add new npm dependencies without asking
- Every change must be runnable without additional setup
- Do not change database schema or API response shape unless explicitly requested
