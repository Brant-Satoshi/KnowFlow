# KnowFlow

> **English** · [简体中文](./README.zh-CN.md)

A Next.js (App Router) RAG chat application. Upload documents into a knowledge base, ask questions, get streamed answers with inline citations back to the source chunks.

Stack: Next.js 16 (React 19) · PostgreSQL + pgvector (Supabase-hosted) · OpenRouter (chat + embeddings + Cohere rerank) · Supabase Storage (file blobs) · Tailwind v4 + Radix UI.

Multi-tenant: session-cookie auth, and every knowledge base belongs to a workspace with owner/admin/member roles, invite links, and a workspace switcher on the home page.

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
make migrate     # runs 001_init … 012_add_eval_run_filter against the container
make seed        # optional fixtures
```

If you're pointing at Supabase / a remote Postgres, run `make migrate-supabase` (applies the same files via `psql` against `DATABASE_URL`; migrations are idempotent).

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

Five user-facing pages — do not add more:

- `/` — Knowledge Base list (CRUD) with workspace switcher / members / join dialogs
- `/knowledge-bases/[id]/chat` — RAG chat scoped to a single KB
- `/eval` — offline evaluation dashboard
- `/login`, `/register` — authentication

API surface lives under `app/api/` (auth, workspaces, knowledge bases, files, conversations, RAG search, chat stream, eval run). See `Architecture.md` for the full inventory.

---

## How a chat request flows

`POST /api/chat/stream` (SSE):

1. Embed the user query (`lib/rag/embeddings.ts`)
2. Vector-search top-20 chunks scoped to the KB, cosine distance < 0.6, optionally narrowed by a retrieval filter (file / type / title) (`lib/db/chunks.ts`)
3. Rerank via Cohere/OpenRouter, keep top-8 (`lib/rag/rerank.ts`)
4. Slice to top-5 as the evidence pack
5. Build a citation-aware prompt and stream tokens back (`lib/llm/chat.ts`)

SSE event order: `progress*` → `meta` → `progress` → `token*` → `done` (or `error`), plus a `title` event when a conversation title is auto-generated. Every event carries the `requestId`.

### Retrieval metadata filter

`POST /api/chat/stream`, `/api/rag/search`, and `/api/eval/run` all accept an optional `filter` object that narrows vector search before reranking (exposed in the chat and eval UIs; eval runs persist it on `eval_runs.filter`):

```jsonc
{
  "filter": {
    "fileIds": ["<uuid>", "..."],        // max 50, ORed
    "fileTypes": ["pdf", "markdown"],    // pdf | markdown | word | text (by file extension), ORed
    "titleQuery": "chapter 3"            // case-insensitive substring on document/section title, max 200 chars
  }
}
```

Dimensions are ANDed; values within a dimension are ORed. Validation lives in `parseRetrievalFilter` (`lib/validation.ts`); the filter compiles to extra SQL `WHERE` clauses in `searchChunks` (`lib/db/chunks.ts`).

---

## Conventions

- **API response shape**: every endpoint returns `{ requestId, ok, data?, error? }` via `lib/api/response.ts`.
- **i18n**: no hardcoded English/Chinese in JSX or `aria-label` — strings live in `lib/i18n/translations.ts` (both `en` and `zh`).
- **Interactive elements** (`button`, `a`, clickable `div`s) must include `cursor-pointer`.
- **No new top-level routes**, **no new npm dependencies**, and **don't change the DB schema or API response shape** without explicit ask.

See `CLAUDE.md` for the full set of repo conventions and `Architecture.md` for the design rationale, tradeoffs, and failure-mode strategies. Individual decisions and their tradeoffs are recorded in [`docs/adr/`](./docs/adr/README.md).
