# Project Rules

## Project Overview
- Next.js App Router project for a RAG + LLM chat application.
- Uses PostgreSQL + pgvector for vector storage.

## Commands
```sh
pnpm dev          # start the development server
pnpm build        # production build and type-check
pnpm lint         # run ESLint
pnpm test:e2e     # Playwright end-to-end tests
pnpm test:unit    # node:test via tsx (lib/**/*.test.ts)
pnpm seed:demo    # idempotent demo login + indexed bilingual KB
pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid>  # vector vs hybrid A/B
```

Unit tests run on Node's built-in runner (no extra dependency); `pnpm build` still catches type errors project-wide.

## Routes
- `/` - Knowledge Base list
- `/knowledge-bases/:id/chat` - Chat page
- `/eval` - Evaluation page
- `/login`, `/register` - Authentication pages

## Core Modules
- `lib/llm/` - LLM calls
- `lib/rag/` - RAG flow, including chunking, embeddings, and search
- `lib/db/` - PostgreSQL database operations
- `lib/auth/` - Authentication (sessions, users, password, cookies)
- `lib/authz/` - Workspace access guards (`requireKnowledgeBaseAccess` etc.); all KB-scoped API routes must use them
- `lib/eval/` - Evaluation datasets and run logic
- `lib/api/` - API response helpers
- `lib/i18n/` - Translations
- `lib/telemetry/` - Telemetry

Chat and eval share retrieval through `lib/rag/retrieve.ts`. Vector recall is the production default; hybrid vector + pg_trgm recall is experimental and only enabled by `HYBRID_SEARCH_ENABLED=true`. Do not enable it by default without a same-corpus `pnpm eval:hybrid-ab` comparison; see ADR-010.

## Shared Types (lib/types.ts)
- `Message`, `Conversation` - chat-related types (`Conversation` includes `model: string | null`)
- `KnowledgeBase` - knowledge base type
- `FileDoc`, `Chunk`, `Citation` - file and RAG-related types

## API Response Shape
All API endpoints must include `requestId`:
```typescript
{ requestId, ok, data?, error? }
```

## i18n
All user-visible strings must use the translation system. Do not hardcode English or Chinese text in JSX, `aria-label`, placeholders, titles, toast messages, dialog text, buttons, menus, or empty states.

- Translation file: `lib/i18n/translations.ts`.
- There are four top-level translation sections per language: `home`, `chat`, `eval`, `auth`. `useLanguage()` exposes them as `{ home, t (= chat), evalT, authT }`.
- Add keys to both `en` and `zh` whenever introducing new strings.
- For parameterized strings, use a `{placeholder}` convention and replace at the call site, for example `t.noResults.replace("{query}", searchQuery)`.
- Sub-components that render text must receive `t` as a prop, typed as `ReturnType<typeof useLanguage>["home" | "t" | "evalT" | "authT"]`, rather than calling `useLanguage()` themselves, unless they are already client components with clear ownership.
- Developer-only messages, such as thrown errors that are not shown to users, do not need translation.

## Frontend Conventions
- Interactive elements (`button`, `a`, clickable `div`s) must include `cursor-pointer`.

## Constraints
- Do NOT add new top-level pages beyond the routes listed above (`/`, `/knowledge-bases/:id/chat`, `/eval`, `/login`, `/register`).
- Do NOT add a `/files` route unless explicitly requested.
- Keep changes minimal and runnable
- Use standard API response shape

## Output format whenever asked to implement:
1) List changed files
2) Provide file-by-file code
3) Provide commands to run + checklist to verify
