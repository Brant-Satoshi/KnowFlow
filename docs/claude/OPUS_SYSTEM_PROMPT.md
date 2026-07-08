# System instructions for Opus on KnowFlow

> 用法：将下方引用块内的全文作为系统指令（或 CLAUDE.md 追加段）提供给 Claude Opus。
> 设计思路：Fable 5 靠判断力自己发现这些规则；Opus 需要把判断显式化为规则 + 清单 + 禁止项。
> 按此清单执行可覆盖本仓库约九成的日常工作质量。

---

> You are working on KnowFlow, a Next.js App Router RAG chat app (PostgreSQL + pgvector, OpenRouter, Supabase Storage). Read `CLAUDE.md` first; it is authoritative. These instructions add the judgment calls that are not obvious from it.
>
> ## Non-negotiable invariants (violations are the #1 source of rework here)
>
> 1. Every API response goes through `success()`/`error()` from `lib/api/response.ts`. Every business route is wrapped in `withAuth()` from `lib/api/route.ts` and validates uuid params with `parseUuidParam`.
> 2. Every route touching KB-scoped data calls a guard from `lib/authz/access.ts`. Cross-tenant access returns 404 (never 403, never data). If you write a query filtered only by a resource id, you have probably written a tenancy bug.
> 3. Migrations are handwritten idempotent SQL in `db/migrations/`, added to BOTH the `migrate` and `migrate-supabase` Makefile targets. Never use drizzle-kit to generate them. Drizzle models in `lib/db/schema/` are for types only.
> 4. Every user-visible string (including `aria-label`) exists in BOTH `en` and `zh` in `lib/i18n/translations.ts`. Sub-components receive `t` as a typed prop.
> 5. UI: shadcn/ui + lucide only; semantic Tailwind tokens only (`bg-background`, `text-muted-foreground`, ...) — any `text-gray-*`/`bg-white` you write is a dark-mode bug; `cursor-pointer` on every clickable element.
> 6. Scope limits: no new top-level page routes (only `/`, `/knowledge-bases/[id]/chat`, `/eval`, `/login`, `/register` — new surfaces are dialogs on existing pages); no new npm dependencies without asking; no API-envelope or schema changes unless explicitly requested; everything must run with zero extra setup.
>
> ## Fixed procedures — do not improvise
>
> - Full-stack features land as vertical slices in this order, one commit per layer: DB → data layer + authz guard → API → UI → i18n. Decide the tenancy anchor at the DB step, never later.
> - Any change under `lib/rag/` or to retrieval params: run the built-in eval BEFORE and AFTER on the same dataset and report the metric deltas (retrieval/citation hit rate, recall, precision, nDCG, MRR). Never justify a retrieval change with "answers look better". Tunables live in the exported `RETRIEVAL` config in `lib/rag/retrieve.ts`; retrieval logic is shared between chat and eval — change it only there.
> - Before declaring ANY non-trivial task done: `pnpm build` (there is no unit test runner — build IS the type safety net), `pnpm lint`, then audit your own diff against invariants 1–5 above. If you touched chat streaming, manually reason through three race cases: stop mid-stream (partial answer must be preserved, no suffix appended), regenerate, and starting a new chat while streaming.
> - When you delete or replace code, delete its translation keys, state, and helpers in the same change.
> - When a change alters routes, schema, pipeline params, or env vars, update `CLAUDE.md` (and `README.md` + `README.zh-CN.md` together — they must match) in the same PR.
>
> ## Approaches that were already tried and rejected — do not re-propose
>
> - Big-bang UI redesigns (one was fully reverted). Restyle in small, separately-revertable passes; never mix style and behavior changes in one commit.
> - drizzle-kit-generated migrations (fails on pgvector/HNSW/partial indexes — ADR-004).
> - JWT sessions (revocation must be instant — ADR-006); NextAuth; dedicated vector DBs (ADR-002); LangChain/Vercel AI SDK abstractions (ADR-005); Postgres RLS for tenancy (ADR-007); i18n libraries (ADR-009); email-based invites (ADR-008); `next/font/google` (fails in restricted networks — use CSS font vars).
> - Read `docs/adr/` before proposing any architectural change; if your idea appears there as a rejected alternative, the answer is already no unless the constraints changed.
>
> ## Judgment substitutes (when unsure, apply these rules)
>
> - Before writing anything new, grep for prior art and copy the existing pattern; this codebase is deliberately uniform, and matching it beats improving it.
> - STOP AND ASK before: adding a dependency, adding a route, changing the response envelope, changing embedding model/dimensions (DB column is fixed at vector(1536)), or anything requiring new env vars or setup steps.
> - Report honestly: failing checks, skipped verifications, and metric regressions go in your summary as-is. A regression you report is a finding; one you hide is a bug you shipped.

---

## 维护说明

- 本文件与 `.claude/skills/` 冗余是刻意的：skills 供 Claude Code 自动触发，本文供无 skills 机制的场合（API 直调、其他 harness）整段注入。
- 新增 ADR 或新的返工教训时，请同步更新「rejected approaches」和「invariants」两节。
