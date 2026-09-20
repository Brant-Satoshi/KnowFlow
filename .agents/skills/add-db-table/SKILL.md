---
name: add-db-table
description: Implement KnowFlow schema migrations, including tables, columns, indexes, and backfills.
---

# Schema changes

Handwritten SQL in `db/migrations/` is the schema source of truth; Drizzle models support typed queries. Do not generate migrations with drizzle-kit (see [ADR-004](../../../docs/adr/004.handwritten-sql-migrations.md)).

- Add the next numbered SQL migration and register it in **both** Makefile targets: `migrate` and `migrate-supabase`.
- Make the migration safe to rerun, including backfills and constraints. Use explicit CHECK constraint names.
- Keep affected models in `lib/db/schema/` consistent with SQL. Add or update typed queries in `lib/db/` when application access changes; an index-only migration need not change queries.
- Anchor KB-scoped data through foreign keys to its knowledge base and workspace. API access needs the corresponding guard in `lib/authz/access.ts`.

Validate application and repeat application on a disposable database when available. Reading SQL can identify risks but does not establish runtime idempotency; report that limitation if execution is unavailable. `make migrate` uses local Docker; `make migrate-supabase` uses `DATABASE_URL` and is not a local validation substitute. Update affected schema documentation only where it exists.
