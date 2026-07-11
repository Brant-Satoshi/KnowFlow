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
- `HYBRID_SEARCH_ENABLED=true` — fuse a pg_trgm keyword leg into chat recall via RRF (default off; the eval found no gain on the current dataset — see ADR-010)

> **Embeddings must be 1536-dimensional.** The `chunks.embedding` column is `vector(1536)` and the code validates dimension on every call.

### Database setup

Migrations live in `db/migrations/`. Migration targets assume a local Docker Postgres container named `knowflow-postgres`; the demo seed uses `DATABASE_URL`, so the same command works against local or remote Postgres:

```bash
make migrate     # runs 001_init … 014_managed_eval_datasets against the container
make seed        # deterministic demo account + bilingual Olympus KB + built-in eval datasets
```

If you're pointing at Supabase / a remote Postgres, run `make migrate-supabase` (applies the same files via `psql` against `DATABASE_URL`; migrations are idempotent).

`make seed` embeds the tracked `sample.txt` / `sample-zh.txt` fixtures and replaces only `demo@knowflow.local`; it never clears other accounts. It also creates the built-in `olympus` / `olympus-zh` eval datasets, but only when a dataset of that name is absent — an edited dataset is never restored to the template. It prints the login and fixed KB id when complete. Override the demo credentials with `DEMO_SEED_EMAIL` and `DEMO_SEED_PASSWORD`. Use `pnpm seed:demo -- --dry-run` to verify fixture/chunk counts without network or database writes.

---

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Next dev server on `localhost:3000` |
| `pnpm build` | Production build (also serves as type-check) |
| `pnpm start` | Run the built app |
| `pnpm lint` | ESLint |
| `pnpm test:unit` | Node built-in unit tests (`lib/**/*.test.ts`) |
| `pnpm test:e2e` | Playwright end-to-end tests (`tests/`) |
| `pnpm seed:demo` | Idempotently create the demo login, indexed bilingual KB, and built-in eval datasets |
| `pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid> --dataset-id=<uuid>` | Compare vector vs hybrid retrieval quality and latency |

---

## Routes

Five user-facing pages — do not add more:

- `/` — Knowledge Base list (CRUD) with workspace switcher / members / join dialogs
- `/knowledge-bases/[id]/chat` — RAG chat scoped to a single KB
- `/eval` — offline evaluation dashboard with managed golden sets (create/edit/import datasets, validate against a KB, compare runs by content hash)
- `/login`, `/register` — authentication

API surface lives under `app/api/` (auth, workspaces, knowledge bases, files, conversations, RAG search, chat stream, eval datasets and runs). See `Architecture.md` for the full inventory.

---

## How a chat request flows

`POST /api/chat/stream` (SSE):

1. Embed the user query (`lib/rag/embeddings.ts`)
2. Recall top-20 chunks through `lib/rag/retrieve.ts`: vector by default, or vector + pg_trgm keyword fused with RRF when the experimental `HYBRID_SEARCH_ENABLED=true`; both modes share KB scope and filters
3. Rerank via Cohere/OpenRouter, keep top-8 (`lib/rag/rerank.ts`)
4. Slice to top-5 as the evidence pack
5. Build a citation-aware prompt and stream tokens back (`lib/llm/chat.ts`)

SSE event order: `progress*` → `meta` → `progress` → `token*` → `done` (or `error`), plus a `title` event when a conversation title is auto-generated. Every event carries the `requestId`.

Hybrid remains experimental and defaults off: the reproducible `olympus-zh` A/B found no hit-rate or Recall@5 gain. Raw ranking signals were mixed; production rerank made quality effectively flat while this run measured +11.7% average and +18.7% p50 latency. See the [recorded A/B report](./docs/evals/hybrid-ab-2026-07-10.md) and [ADR-010](./docs/adr/en/010.hybrid-search-rrf-gated.md).

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
