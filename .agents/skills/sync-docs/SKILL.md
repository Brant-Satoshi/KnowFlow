---
name: sync-docs
description: Reconcile KnowFlow documentation with changed behavior, setup, or architecture, or audit reported drift.
---

# Documentation accuracy

Use the task's actual diff or requested scope, including relevant working-tree changes. Verify affected claims against code; do not assume a particular base branch or reread every document.

Route changes to the documents that describe them:

- `README.md` and `README.zh-CN.md`: features, setup, and commands; keep corresponding content equivalent.
- `Architecture.md`: components, data flow, and schema.
- `RAG_pipeline.md`: retrieval stages and parameters; read current values from `lib/rag/retrieve.ts`.
- `AGENTS.md` and `CLAUDE.md`: durable agent guidance. Keep shared facts consistent without making them mirrors or adding generated inventories.
- `docs/adr/` and `docs/adr/en/`: recorded decisions; update status or add a superseding ADR when a decision changes.

Update only affected claims and bilingual counterparts. Avoid duplicating volatile values across documents or prescribing a separate documentation commit.
