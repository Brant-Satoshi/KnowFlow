---
name: sync-docs
description: Sync CLAUDE.md, AGENTS.md, README.md, README.zh-CN.md, Architecture.md, and RAG_pipeline.md with the current codebase. Use after any feature/refactor lands, or on demand ("同步文档", "docs drifted"). Doc drift has required at least five dedicated cleanup commits in this repo's history — sync in the same PR instead.
---

# Sync docs with code

The doc set describes the code; the code moves; the docs rot. Run this after any change that touches routes, schema, pipeline stages, env vars, commands, or module layout.

## What to check, per file

- **`CLAUDE.md`** (highest value — it steers every future agent session):
  - Route list, table list *and count*, RAG stage numbers/params, SSE event types, env vars, "Adding a table" steps, key file paths. Verify each claim by grepping the code, not from memory.
- **`AGENTS.md`** — mirror of CLAUDE.md for other agents; keep the module map and rules consistent with CLAUDE.md (they have drifted apart before).
- **`README.md` / `README.zh-CN.md`** — feature list, setup steps, commands. The two languages must say the same thing; update both or neither. `README.md` holds both languages in `<details name="readme-lang">` accordion blocks (the top language-switch buttons); its Chinese block must stay identical to `README.zh-CN.md` — three copies move together.
- **`Architecture.md`** — component diagram prose, data flow, schema description.
- **`RAG_pipeline.md`** — stage-by-stage pipeline description; must match `lib/rag/retrieve.ts` and the `RETRIEVAL` config values exactly (top-20 / distance 0.6 / topN 8 / top-5 as of writing — re-check, don't copy).
- **`docs/adr/`** — if the change reverses or extends a recorded decision, update the ADR status or write a new one (`write-adr` skill). Both zh and `en/` copies.

## Method

1. `git diff main...HEAD --stat` (or the recent merge range) to see what moved.
2. For each doc claim in scope, verify against the code with Grep/Read. Numbers (table counts, top-K values, route counts) are the usual liars.
3. Fix bilingual pairs together (README ↔ README.zh-CN, adr ↔ adr/en).
4. Commit as `docs: sync <files> with <change>`.

## Anti-goal

Do not pad docs with new sections nobody asked for. This skill removes drift; it doesn't grow the doc set.
