---
name: ship-check
description: Final pre-commit/pre-PR verification pass for any KnowFlow change. Use before declaring any non-trivial task done — runs the build/lint gates, the convention audits, and the streaming race-case checklist that have each caught real regressions in this repo.
---

# Ship check

Run this before committing/pushing any non-trivial change. Every item exists because skipping it once produced a real fix-commit.

## Gates (must pass)

1. `pnpm build` — the type-check. There is **no unit test runner**; build is the safety net.
2. `pnpm lint`
3. If routes/pages changed and the environment allows: `pnpm test:e2e` (Playwright). If tests reference selectors you renamed, update the tests in the same change.

## Diff audits

4. Run the `ui-conventions-audit` skill if any `.tsx` changed (i18n both languages, cursor-pointer, semantic tokens, shadcn-only).
5. API surface: every touched route still returns the `{ requestId, ok, data?, error? }` envelope and goes through `withAuth` + an authz guard.
6. Dead code: if you replaced or removed a feature, delete its translation keys, unused state, and unused helpers *now* (past cleanups: `deleteLoading` keys, `deletingIds`, dead `answerable` flag).
7. Scope: no new top-level routes, no new npm deps, no schema/envelope changes beyond what was asked.

## Behavior spot-checks (when the area was touched)

- **Chat streaming**: stop mid-stream keeps the partial answer (no "[Stopped]" suffix); starting a new chat doesn't abort itself; regenerate works; SSE `progress → meta → token+ → done` ordering intact.
- **Tenancy**: hit a touched endpoint with a user from another workspace → must be 404, not 403/500/data.
- **Both themes + both languages**: flip dark/light and en/zh once on changed screens.

## Report honestly

State what was run and what wasn't (e.g. "e2e skipped: no DB in this environment"). A skipped check is a line in the summary, not a silent omission.
