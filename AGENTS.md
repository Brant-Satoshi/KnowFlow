# Project Rules

## Project Overview
- Next.js App Router project for a RAG + LLM chat application.
- Uses PostgreSQL + pgvector for vector storage.

## Commands
```sh
pnpm dev          # start the development server
pnpm build        # production build and type-check
pnpm lint         # run ESLint
```

No test runner is configured. Use `pnpm build` to catch type errors.

## Routes
- `/` - Knowledge Base list
- `/knowledge-bases/:id/chat` - Chat page
- `/eval` - Evaluation page

## Core Modules
- `lib/llm/` - LLM calls
- `lib/rag/` - RAG flow, including chunking, embeddings, and search
- `lib/db/` - PostgreSQL database operations
- `lib/telemetry/` - Telemetry

## Shared Types (lib/types.ts)
- `Message`, `Conversation` - chat-related types
- `FileDoc`, `Chunk`, `Citation` - file and RAG-related types

## API Response Shape
All API endpoints must include `requestId`:
```typescript
{ requestId, ok, data?, error? }
```

## i18n
All user-visible strings must use the translation system. Do not hardcode English or Chinese text in JSX, `aria-label`, placeholders, titles, toast messages, dialog text, buttons, menus, or empty states.

- Translation file: `lib/i18n/translations.ts`.
- There are two top-level translation sections:
  - `home`, accessed with `const { home: t } = useLanguage()`.
  - `chat`, accessed with `const { t } = useLanguage()`.
- Add keys to both `en` and `zh` whenever introducing new strings.
- For parameterized strings, use a `{placeholder}` convention and replace at the call site, for example `t.noResults.replace("{query}", searchQuery)`.
- Sub-components that render text must receive `t` as a prop, typed as `ReturnType<typeof useLanguage>["home" | "chat"]`, rather than calling `useLanguage()` themselves, unless they are already client components with clear ownership.
- Developer-only messages, such as thrown errors that are not shown to users, do not need translation.

## Constraints
- Do NOT add extra pages beyond `/`, `/knowledge-bases/:id/chat`, and `/eval`.
- Do NOT add a `/files` route unless explicitly requested.
- Keep changes minimal and runnable
- Use standard API response shape

## Output format whenever asked to implement:
1) List changed files
2) Provide file-by-file code
3) Provide commands to run + checklist to verify


<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37701
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>