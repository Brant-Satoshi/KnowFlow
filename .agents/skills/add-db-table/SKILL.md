---
name: add-db-table
description: Add a new database table (or column) to KnowFlow. Use whenever a task requires schema changes — new table, new column, new index, or a backfill. Covers the four mandatory touch points (Drizzle model, handwritten SQL migration, both Makefile targets, query module) that are easy to miss.
---

# Add a database table or column

Schema changes in this repo have exactly one source of truth: **handwritten SQL in `db/migrations/`**. Drizzle models are for type inference only; `drizzle-kit generate` is never used (see `docs/adr/004.handwritten-sql-migrations.md`).

## Steps (all four are mandatory)

1. **Drizzle model** — define/extend the table in the right file under `lib/db/schema/`:
   - `auth.ts` — users, sessions, workspaces, members, invites
   - `core.ts` — knowledge bases, files, chunks, conversations, messages
   - `eval.ts` — eval datasets, cases, runs, run items
2. **SQL migration** — handwrite `db/migrations/0NN_<slug>.sql` (next number in sequence). Requirements:
   - **Idempotent**: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, guarded `DO $$ ... $$` blocks for backfills and constraints. The full migration sequence must be safe to re-run from scratch.
   - Name CHECK constraints explicitly.
   - If the table is KB-scoped, include the FK chain that anchors it to a tenant (`knowledge_base_id` → `workspaces` via `knowledge_bases.workspace_id`).
3. **Makefile** — add the new file to **both** targets: `migrate` (local Docker, `docker exec ... psql`) and `migrate-supabase` (remote via `DATABASE_URL`). Forgetting one target is the classic mistake.
4. **Query module** — add/extend a module in `lib/db/` with typed query functions. Do not scatter raw queries in route handlers.

## Follow-ups

- If the new data is reachable via API, every route touching it must go through a guard in `lib/authz/access.ts` (add a `require<X>Access` if the resource type is new). Cross-tenant → 404, anonymous → 401.
- Update the schema section of `AGENTS.md` (table list + count) and `Architecture.md` if the shape changed materially.
- Verify: `make migrate` against local Docker (or confirm SQL idempotency by reading it twice), then `pnpm build` for type errors.
