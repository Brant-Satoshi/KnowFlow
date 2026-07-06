---
name: feature-slice
description: Build a full-stack KnowFlow feature end to end (DB → data layer → authz → API → UI → i18n). Use when a task adds user-facing functionality that spans more than one layer. Encodes the slice order and commit discipline that past features (auth, workspaces, invites, eval persistence, retrieval filters) converged on.
---

# Full-stack feature slice

Features in this repo land as **thin vertical slices in a fixed order**, one commit per layer. This order exists because reversing it (UI first, tenancy later) forced painful backfills and a repo-wide guard-enforcement pass in the past.

## Slice order

1. **DB** — if new tables/columns are needed, run the `add-db-table` skill first. Commit: `feat(db): ...`
2. **Data layer + authz** — query module in `lib/db/`, guard in `lib/authz/access.ts` if a new resource type exists. Decide the tenancy anchor *now* (everything KB-scoped inherits workspace via the FK chain). Commit: `feat(<area>): ... data layer and authz guard`
3. **API** — routes per the `new-api-route` skill. Commit: `feat(api): ...`
4. **UI** — shadcn/ui components + lucide icons only; semantic Tailwind tokens (`bg-background`, `text-muted-foreground`, ...) never raw palette classes; `cursor-pointer` on every interactive element. Commit: `feat(ui): ...`
5. **i18n** — every user-visible string (including `aria-label`) added to **both** `en` and `zh` in `lib/i18n/translations.ts`, in the right section (`home`/`chat`/`eval`/`auth`). Sub-components receive `t` as a typed prop. Do this *inside* the UI commit, not as a follow-up fix.

## Hard constraints (do not negotiate these away mid-feature)

- No new top-level page routes beyond `/`, `/knowledge-bases/[id]/chat`, `/eval`, `/login`, `/register`. New surfaces are dialogs/sheets on existing pages (the workspace switcher/members/join dialogs are the precedent).
- No new npm dependencies without asking the user first.
- No API envelope or schema changes unless the task explicitly asks.
- Must run with zero extra setup (`pnpm dev` + existing env vars).

## Before declaring done

Run the `ui-conventions-audit` skill on the diff, then `pnpm build` and `pnpm lint`. If the feature touches chat streaming, manually test the race cases: stop mid-stream (partial answer must be kept), regenerate, and starting a new chat while a stream is active.
