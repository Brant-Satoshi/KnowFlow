---
name: write-adr
description: Record an architecture decision as an ADR in docs/adr/ (Chinese primary + English copy in docs/adr/en/). Use when a change locks in something hard to reverse — new external service, storage/auth/tenancy model, protocol choice, or when deliberately rejecting an approach so it isn't re-proposed later.
---

# Write an ADR

ADRs exist so that rejected approaches stay rejected. If you just spent effort deciding *against* something (an ORM feature, a library, an architecture), that's exactly what to record — future sessions will otherwise re-propose it.

## When

- The decision is expensive to reverse (storage, auth, tenancy, wire protocol, external service).
- An approach was tried and abandoned (record it as the rejected alternative, with the real reason).
- A constraint looks arbitrary without context (e.g. "no email infra", "zero-setup runnable") and needs a durable home.

## Format (follow ADR-001 exactly)

```
# ADR-NNN：<决策标题>

## 状态
已接受 | 已废弃（被 ADR-MMM 取代）

## 背景
<问题与约束 —— 为什么现在必须决定>

## 决策
<选了什么，如何落地，指向具体文件/迁移>

## 备选方案
### <方案 A>
优点：/ 缺点：

## 取舍
优点：+ ...
缺点：− ...

## 影响
<对后续工作的约束>
```

## Steps

1. Next number: `ls docs/adr/` → `NNN.slug.md`.
2. Write the Chinese version in `docs/adr/`, then an English copy at `docs/adr/en/NNN.slug.md` (same structure; both are maintained).
3. Add a row to the table in `docs/adr/README.md` (decision + key trade-off) — and `docs/adr/en/README.md`.
4. Reference concrete artifacts: file paths, migration numbers, env vars. An ADR that names no files goes stale invisibly.
5. Commit as `docs(adr): record <decision>`.

## Quality bar

The **备选方案/alternatives** section is the point — state the strongest version of each rejected option and the specific reason it lost *in this repo's constraints* (see ADR-004: drizzle-kit lost because of pgvector/HNSW/partial-index DDL, not because it's bad).
