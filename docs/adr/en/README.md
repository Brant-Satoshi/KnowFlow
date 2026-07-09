# Architecture Decision Records

One file per significant, hard-to-reverse decision. Format follows ADR-001:
Status / Context / Decision / Alternatives considered / Tradeoffs /
Consequences / Notes. Add new records as `NNN.slug.md`.

Chinese versions are in the parent directory: [../README.md](../README.md).

| ADR | Decision | Key tradeoff |
| --- | --- | --- |
| [001](./001.use-streaming.md) | SSE + client buffer/flush for streaming | Smooth streaming UX vs one-way transport + manual buffer control |
| [002](./002.pgvector-in-postgres.md) | Vectors in Postgres (pgvector + HNSW) | One transactional store vs global ANN index post-filtered per tenant |
| [003](./003.two-stage-retrieval.md) | Vector recall top-20 -> Cohere rerank -> top-5 | Cross-encoder precision vs +1 API hop per message (feature-flagged) |
| [004](./004.handwritten-sql-migrations.md) | Handwritten idempotent SQL; Drizzle types only | Full DDL control vs dual-maintenance of schema.ts and .sql |
| [005](./005.openrouter-single-gateway.md) | OpenRouter gateway for chat/embed/rerank | One key + catalog-driven model swap vs extra hop + wrapped errors |
| [006](./006.opaque-db-sessions.md) | Opaque DB sessions, not JWT | Instant revocation vs a DB read per request |
| [007](./007.workspace-tenancy-app-guards.md) | Shared-schema tenancy, app-layer guards, 404 anti-enumeration | Explicit auditable guards vs must-remember-per-route (no RLS) |
| [008](./008.invite-code-collaboration.md) | Multi-use expiring invite codes | Zero email infra + consent-by-action vs out-of-band token handling |
| [009](./009.hand-rolled-i18n.md) | Hand-rolled typed en/zh dictionary | Compile-time-checked keys, zero deps vs no ICU/plurals |
| [010](./010.hybrid-search-rrf-gated.md) | Hybrid search (RRF vector + keyword), default off | Toggleable capability landed vs eval shows no gain on current dataset, so not default-on |
