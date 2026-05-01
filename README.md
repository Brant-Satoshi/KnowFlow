# ai-rag-app

A Next.js (App Router) RAG chat app. Upload documents into a knowledge base, then chat with answers grounded in retrieved chunks. Citations, streaming, and an evaluation harness are included.

## Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS 4, Radix UI, lucide-react
- **Vector store**: PostgreSQL 18 + [pgvector](https://github.com/pgvector/pgvector) (HNSW index, cosine distance)
- **LLM**: MiniMax `abab6.5-chat` (streamed via SSE)
- **Embeddings**: MiniMax or any OpenAI-compatible endpoint — 1536-dim
- **Rerank**: OpenRouter `cohere/rerank-v3.5` (toggle with `RERANK_ENABLED`)
- **Parsing**: `pdf2json`, `mammoth` (DOCX)
- **Tests**: Playwright (`pnpm test:e2e`)

## Routes

The app has exactly three top-level routes:

| Route | Purpose |
|---|---|
| `/` | Knowledge base list / CRUD |
| `/knowledge-bases/[id]/chat` | RAG chat scoped to a single KB |
| `/eval` | Evaluation runner |

## RAG pipeline

Per request to [`app/api/chat/stream/route.ts`](app/api/chat/stream/route.ts):

1. **Embed** the user query — [`lib/rag/embeddings.ts`](lib/rag/embeddings.ts) (`embedText`)
2. **Vector search** top-20 chunks with cosine distance < 0.4 — [`lib/db/chunks.ts`](lib/db/chunks.ts) (`searchChunks`)
3. **Rerank** via OpenRouter/Cohere, take top-5 — [`lib/rag/rerank.ts`](lib/rag/rerank.ts) (`rerankChunks`)
4. **Prompt build** — [`lib/llm/chat.ts`](lib/llm/chat.ts) (`buildPrompt`)
5. **Stream** tokens from MiniMax as SSE — [`lib/llm/chat.ts`](lib/llm/chat.ts) (`streamAnswer`)

SSE event order: `meta` → `token`+ → `done` (or `error`). Every event carries a `requestId`.

## Database schema

Three tables (see [`db/migrations/`](db/)):

- `knowledge_bases` — `id`, `name`, `description`
- `files` — `id`, `name`, `type`, `size`, `status`, `knowledge_base_id` (FK)
- `chunks` — `id`, `file_id` (FK), `idx`, `text`, `embedding vector(1536)`

An HNSW index on `chunks.embedding` powers fast cosine search.

## API conventions

Every endpoint returns the shape from [`lib/api/response.ts`](lib/api/response.ts):

```ts
{ requestId: string, ok: boolean, data?: T, error?: string }
```

Use `success(data)` / `error(message)` helpers; `requestId` is generated per call by [`lib/telemetry/requestId.ts`](lib/telemetry/requestId.ts).

Endpoints:
- [`app/api/knowledge-bases/`](app/api/knowledge-bases/) — KB CRUD
- [`app/api/files/`](app/api/files/) — upload, fetch, delete
- [`app/api/chat/stream/`](app/api/chat/stream/) — SSE chat
- [`app/api/rag/search/`](app/api/rag/search/) — raw retrieval (debug)
- [`app/api/eval/run/`](app/api/eval/run/) — evaluation runs

## Getting started

### 1. Install

```sh
pnpm install
```

### 2. Start Postgres + pgvector

```sh
docker compose up -d
make migrate          # apply db/migrations/*.sql
make seed             # optional sample data
```

The container `ai-rag-postgres` exposes Postgres on `localhost:5433`.

### 3. Configure environment

Create `.env.local` with:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5433/airag

# LLM
MINIMAX_API_KEY=...
MINIMAX_BASE_URL=https://api.minimax.chat/v1

# Embeddings — pick one
MINIMAX_EMBEDDING_MODEL=embo-01
# or
OPENAI_BASE_URL=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Reranking (optional; set RERANK_ENABLED=false to disable)
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_RERANK_MODEL=cohere/rerank-v3.5
```

Embedding vectors must be 1536-dimensional to match the schema.

### 4. Run

```sh
pnpm dev              # http://localhost:3000
pnpm build            # production build + type-check
pnpm lint             # ESLint
pnpm test:e2e         # Playwright end-to-end tests
```

## i18n

User-visible strings live in [`lib/i18n/translations.ts`](lib/i18n/translations.ts) under `home` and `chat` sections. Both `en` and `zh` must be kept in sync — no hardcoded English/Chinese in JSX or `aria-label`. Parameterised strings use `{placeholder}` and are interpolated at the call site.

## Project layout

```
app/                    # Next.js App Router (pages + API routes)
components/             # Shared UI (Radix-based)
lib/
  api/                  # Response helpers
  chat/                 # Chat client utilities
  db/                   # Postgres queries (knowledge bases, files, chunks)
  eval/                 # Evaluation harness
  i18n/                 # Translations
  llm/                  # MiniMax client + prompt building
  rag/                  # Embeddings, retrieval, rerank
  telemetry/            # requestId
  types.ts              # Message, Conversation, KnowledgeBase, FileDoc, Chunk, Citation
db/migrations/          # SQL migrations
tests/                  # Playwright specs
```

## Further reading

- [`Architecture.md`](Architecture.md) — deeper design notes
- [`CLAUDE.md`](CLAUDE.md) — guidance for Claude Code when editing this repo
