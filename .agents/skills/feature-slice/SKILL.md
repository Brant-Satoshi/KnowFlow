---
name: feature-slice
description: Coordinate a KnowFlow feature spanning persistence, API, and UI.
---

# Full-stack features

Deliver a working path through the affected layers. Determine the tenancy anchor and access rules before exposing new data; choose implementation order to fit the change.

- For schema changes, use [add-db-table](../add-db-table/SKILL.md).
- Keep typed queries in `lib/db/` and access guards in `lib/authz/access.ts`.
- For endpoint behavior, use [new-api-route](../new-api-route/SKILL.md).
- Apply the UI and bilingual translation conventions in `AGENTS.md` as part of implementation.

Preserve existing setup compatibility where possible. Add layers, dependencies, or configuration only when the feature needs them, and explain any new setup. A feature request can imply necessary schema work; it does not imply changing unrelated API contracts.

Completion includes exercising the affected user flow and resolving failures introduced by the change. Use [ship-check](../ship-check/SKILL.md) when cross-layer verification needs a broader pass. There is no required commit sequence.
