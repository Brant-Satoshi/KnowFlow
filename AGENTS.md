# KnowFlow

Next.js App Router RAG/chat application using PostgreSQL + pgvector.

## Project boundaries

- Page routes are `/`, `/knowledge-bases/[id]/chat`, `/eval`, `/login`, and `/register`. Use existing pages, dialogs, or sheets unless the user requests a new page; do not add `/files` implicitly.
- JSON API responses use `lib/api/response.ts`: `{ requestId, ok, data?, error? }`. Preserve the existing protocol for streaming responses.
- KB-scoped access must use `lib/authz/access.ts` guards, including access through files, conversations, and eval runs. Cross-tenant resources return 404.
- Chat and eval share retrieval in `lib/rag/retrieve.ts`. Vector recall is the default; enabling hybrid by default requires a same-corpus `pnpm eval:hybrid-ab` comparison (see [ADR-010](docs/adr/010.hybrid-search-rrf-gated.md)).
- SQL migrations are handwritten; schema changes follow [add-db-table](.agents/skills/add-db-table/SKILL.md).

## UI conventions

- Use `components/ui/` (shadcn/ui), lucide icons, and semantic Tailwind color tokens. Interactive elements include `cursor-pointer`.
- User-visible interface text, including accessibility labels and notifications, uses both `en` and `zh` entries in `lib/i18n/translations.ts`. User data and developer-only diagnostics do not need translation.
- `useLanguage()` exposes `home`, `t` (chat), `evalT`, and `authT`. Pass the appropriate typed translation prop to sub-components unless they own their client language context. Parameterized strings use `{placeholder}` replacement.

## Development

```sh
pnpm dev
pnpm build         # production build, including type-check
pnpm lint
pnpm test:unit     # node:test via tsx, lib/**/*.test.ts
pnpm test:e2e      # Playwright
pnpm seed:demo     # writes demo login, indexed bilingual KB, and built-in eval datasets
pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid> --dataset-id=<uuid>
```

Complete the requested change through relevant verification and fix failures it introduces. Choose checks for the affected behavior; documentation-only edits do not need application builds. Report results and any checks blocked by the environment. Do not commit or publish unless requested.

Local checks that do not mutate shared data can run without repeated approval. E2E loads `.env.local` and may use configured services; do not assume it, seeding, migrations, or re-embedding targets disposable data.

Use repository skills only for their applicable workflow. Consult [Architecture.md](Architecture.md) for architecture and [RAG_pipeline.md](RAG_pipeline.md) for retrieval details when needed; update affected documentation when behavior changes.
