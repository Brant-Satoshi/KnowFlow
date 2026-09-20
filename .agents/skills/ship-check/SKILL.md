---
name: ship-check
description: Review KnowFlow readiness for a commit or PR, or verify changes spanning multiple subsystems.
---

# Readiness review

Review the requested diff, including relevant uncommitted files. Select checks by what changed and reuse valid results from the current revision.

- Application code: `pnpm build` provides type-checking; `pnpm lint` checks conventions. Run relevant `node:test` tests via `pnpm test:unit` or a targeted `node --import tsx --test <file>`.
- User flows: select relevant Playwright tests when the configured environment is suitable.
- Documentation or instructions only: verify accuracy, references, and any applicable format validator; no application build is needed.

For affected areas, check these project-specific failure modes:

- Streaming: stopping keeps the partial answer without a "[Stopped]" suffix; starting a new chat during a stream does not abort the new chat; regeneration and SSE ordering remain correct.
- Access control: cross-workspace resource requests return 404 and expose no data.
- UI: use [ui-conventions-audit](../ui-conventions-audit/SKILL.md) if a convention review is needed; check changed screens in both themes and languages.
- API contracts: preserve JSON envelopes and streaming protocols.

Report checks run, failures, and unavailable checks. Fix regressions introduced by the task; distinguish unrelated existing failures. This review does not authorize committing, pushing, or deployment.
