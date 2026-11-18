# KnowFlow

> **English** · [简体中文](./README.zh-CN.md)

A Next.js (App Router) RAG chat application. Upload documents into a knowledge base, ask questions, get streamed answers with inline citations back to the source chunks.

**Live demo:** <https://ai-rag-app-ashen.vercel.app> — sign in with `demo@knowflow.local` / `KnowFlowDemo2026!`, open the Olympus Demo knowledge base and ask "Who is the lead researcher of the Olympus Initiative?" The demo account is shared and may be reset.

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

### Python API (optional)

For first-time setup, create the Python virtual environment and install its dependencies from the repository root:

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/python -m pip install -r services/api/requirements.txt
```

Then run `pnpm dev:api` from the repository root. It loads `.env.local` (exported environment variables take precedence), starts FastAPI at `http://127.0.0.1:8000` using that virtual environment, and reloads when Python code changes. Check `/api/health`; press `Ctrl+C` to stop. If the port is occupied, use `pnpm dev:api --port 8001`.

The Python service currently runs independently; start Next.js with `pnpm dev`. Retrieval requires a working database and the OpenRouter configuration below.

One endpoint exists only in the Python service: `POST /api/chat/agent`. Instead of the fixed retrieve-then-answer pipeline, the model (`deepseek/deepseek-chat-v3.1` via OpenRouter) decides what to search for and how many times. The server runs each search in the requested knowledge base (vector recall, rerank, top 5) and returns the whole answer at once, without streaming. Send `{ "message", "knowledgeBaseId", "conversationId"? }` with the `rag_session` cookie. A conversation supplies its latest 8 messages as history, and nothing is written back. `data` holds `answer`, `citations`, `refusal`, `completed`, `stopReason`, and `steps` (one record per model or tool call). An unfinished run still returns 200, with `completed: false`. The loop rules are in [ADR-013](docs/adr/013.fastapi-service-foundation.md): the model must search before answering, the loop allows at most 4 model calls within 30 seconds, and the server refuses when every search is empty.

### MCP (Claude Desktop, stdio)

`services/api/mcp_server.py` exposes the Python `/api/rag/search` endpoint as the read-only `knowflow_search` tool, retaining the API's session and knowledge-base access checks. Parameters are `query` and optional `topK` (default 5, range 1–20), `maxDistance` (default 0.6, range 0–1), and `rerank` (default false). The knowledge base is not a parameter: it comes from `KNOWFLOW_KNOWLEDGE_BASE_ID` in the client configuration, so the model cannot choose it, just as the agent endpoint binds it from the request. Only vector search is supported; keyword, hybrid, fileId, and filter are unavailable.

1. Install the optional dependencies in the existing environment: `services/api/.venv/bin/python -m pip install -r services/api/requirements-mcp.txt`.
2. Run `pnpm dev:api` and keep that terminal running.
3. Log in to KnowFlow using the same database as the Python API. In browser developer tools, find `rag_session` under Application / Storage → Cookies and copy its value. Keep it in local configuration only, never commit credentials, and replace it after session expiry or logout.
4. In Claude Desktop, open Settings → Developer → Edit Config and merge the `knowflow` entry below into the existing `mcpServers`. On macOS, the configuration file is `~/Library/Application Support/Claude/claude_desktop_config.json`. Replace both repository paths with your absolute paths, fill in the session value, and set the knowledge-base UUID (from the KnowFlow `/knowledge-bases/<UUID>/chat` URL). Each entry searches one knowledge base; to use several, add one entry per knowledge base under different names.

```json
{
  "mcpServers": {
    "knowflow": {
      "command": "/absolute/path/to/knowflow/services/api/.venv/bin/python",
      "args": ["/absolute/path/to/knowflow/services/api/mcp_server.py"],
      "env": {
        "KNOWFLOW_API_URL": "http://127.0.0.1:8000",
        "KNOWFLOW_SESSION_TOKEN": "<rag_session value>",
        "KNOWFLOW_KNOWLEDGE_BASE_ID": "<knowledge-base UUID>"
      }
    }
  }
}
```

Fully quit and reopen Claude Desktop; it starts the MCP subprocess over stdio automatically, without a separate manual launch or MCP port. Then ask: "Use knowflow_search to find login documentation and cite your sources." The API address, session, and knowledge base come only from client environment configuration, never tool arguments. Tool discovery works without a session; calls then explain how to configure it.

Successful results preserve `{ requestId, ok, data }`, with structured output and a text fallback. Empty chunks are a successful result; 401, 404, timeouts, and other failures become MCP tool errors. Claude generates the answer from the returned passages. Reserve stdout for MCP messages and send logs to stderr. Do not name the entry point `mcp.py`, which would shadow the SDK package.

Verify with `services/api/.venv/bin/python -m pytest services/api/test_mcp_server.py -q`. Tests use fake HTTP responses and a real stdio subprocess, without database or model access; they skip when the optional SDK is absent. See the [official MCP client setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

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
| `pnpm dev:api` | Python FastAPI on `127.0.0.1:8000`, with `.env.local` loading and automatic reload |
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

Hybrid remains experimental and defaults off: the reproducible `olympus-zh` A/B found no hit-rate or Hit@5 (legacy) gain. Raw ranking signals were mixed; production rerank made quality effectively flat while this run measured +11.7% average and +18.7% p50 latency. See the [recorded A/B report](./docs/evals/hybrid-ab-2026-07-10.md) and [ADR-010](./docs/adr/en/010.hybrid-search-rrf-gated.md).

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
