# KnowFlow

> **English** · [简体中文](./README.zh-CN.md)

A Next.js (App Router) RAG chat application. Upload documents into a knowledge base, ask questions, get streamed answers with inline citations back to the source chunks.

Stack: Next.js 16 (React 19) · PostgreSQL + pgvector (Supabase-hosted) · MiniMax (chat + embeddings) · OpenRouter / Cohere (rerank) · Supabase Storage (file blobs) · Tailwind v4 + Radix UI.

---

## Quickstart

```bash
pnpm install
cp .env.local.example .env.local   # then fill in the keys below
pnpm dev                            # http://localhost:3000
```

> Use **pnpm**, not npm.

`pnpm build` is the canonical type-check (no separate `tsc` step is wired up).

### Required environment variables

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (must have `pgvector` installed) |
| `OPENROUTER_API_KEY` | Single key for chat, embeddings, and rerank — all three go through OpenRouter |
| `OPENROUTER_BASE_URL` | Defaults to `https://openrouter.ai/api/v1` |
| `OPENROUTER_CHAT_MODEL` | Default chat model when the per-conversation UI picker is unset; otherwise the catalog default (`lib/llm/catalog.ts`) applies |
| `OPENROUTER_EMBEDDING_MODEL` | Defaults to `text-embedding-3-small` |
| `OPENROUTER_EMBEDDING_DIMENSIONS` | Defaults to `1536` for `text-embedding-3*` models |
| `OPENROUTER_RERANK_MODEL` | Defaults to `cohere/rerank-v3.5` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Storage for uploaded file blobs |

Optional:
- `RERANK_ENABLED=false` — disable the rerank step

> **Embeddings must be 1536-dimensional.** The `chunks.embedding` column is `vector(1536)` and the code validates dimension on every call.

### Database setup

Migrations live in `db/migrations/`. The `Makefile` targets assume a local Docker Postgres container named `knowflow-postgres`:

```bash
make migrate     # runs 001_init … 005_add_conversation_model against the container
make seed        # optional fixtures
```

If you're pointing at Supabase / a remote Postgres, apply the SQL files in order with whatever client you prefer.

---

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Next dev server on `localhost:3000` |
| `pnpm build` | Production build (also serves as type-check) |
| `pnpm start` | Run the built app |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | Playwright end-to-end tests (`tests/`) |

---

## Routes

Three user-facing pages — do not add more:

- `/` — Knowledge Base list (CRUD)
- `/knowledge-bases/[id]/chat` — RAG chat scoped to a single KB
- `/eval` — offline evaluation dashboard

API surface lives under `app/api/` (knowledge bases, files, conversations, RAG search, chat stream, eval run). See `Architecture.md` for the full inventory.

---

## How a chat request flows

`POST /api/chat/stream` (SSE):

1. Embed the user query (`lib/rag/embeddings.ts`)
2. Vector-search top-20 chunks scoped to the KB, cosine distance < 0.4 (`lib/db/chunks.ts`)
3. Rerank via Cohere/OpenRouter, keep top-8 (`lib/rag/rerank.ts`)
4. Slice to top-5 as the evidence pack
5. Build a citation-aware prompt and stream tokens back (`lib/llm/chat.ts`)

SSE event order: `progress*` → `meta` → `progress` → `token*` → `done` (or `error`). Every event carries the `requestId`.

---

## Conventions

- **API response shape**: every endpoint returns `{ requestId, ok, data?, error? }` via `lib/api/response.ts`.
- **i18n**: no hardcoded English/Chinese in JSX or `aria-label` — strings live in `lib/i18n/translations.ts` (both `en` and `zh`).
- **Interactive elements** (`button`, `a`, clickable `div`s) must include `cursor-pointer`.
- **No new top-level routes**, **no new npm dependencies**, and **don't change the DB schema or API response shape** without explicit ask.

See `CLAUDE.md` for the full set of repo conventions and `Architecture.md` for the design rationale, tradeoffs, and failure-mode strategies.
