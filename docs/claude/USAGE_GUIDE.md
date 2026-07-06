# Claude 使用复盘与优化指南

> 基于本仓库 118 个 commit、34 个 PR、9 篇 ADR 的完整历史分析（2026-07）。
> 产出物：`.claude/skills/` 下 7 个可复用 Skill、`docs/claude/WORKFLOW_TEMPLATES.md` 工作流模板、
> `docs/claude/OPUS_SYSTEM_PROMPT.md` Opus 系统指令。

---

## 1. 我最常使用 Claude 做什么？

按 commit 数量和 PR 分布，工作分为六类（占比从高到低）：

| 类别 | 证据 | 占比（估） |
| --- | --- | --- |
| **UI 打磨 / 重设计** | 三次全量重设计（绿色主题 → archival → Mist/Carbon）、十余次 chat 页布局/间距/badge/光标 polish、主题切换动效 | ~35% |
| **全栈功能切片** | 认证（PR #20 附近）、workspace 多租户（#23/#26）、邀请协作（#27/#28）、eval 持久化（#21）、检索过滤器、模型选择器 | ~25% |
| **重构 / 去重** | `withAuth` 包装器、共享检索管线、`RETRIEVAL` 集中配置、markdown 渲染器去重、统一 out-of-scope 判定（PR #32/#33） | ~15% |
| **RAG 管线迭代** | 两阶段检索、contextual chunk embeddings、rerank A/B、eval 指标（recall/precision/nDCG/MRR + LLM judge） | ~10% |
| **文档同步** | 至少 5 次专门的 "docs: sync/align/rewrite" commit + ADR 撰写与翻译 | ~10% |
| **事后补漏修复** | i18n 漏网字符串、cursor-pointer 补丁、语义 token 修正、流式边界 bug | ~5% |

**结论**：前四类是真正的产出；后两类（文档同步 + 事后补漏）是**本可以消除的重复劳动**，是 Skill 化的最大收益点。

## 2. 哪些任务我总是重复地做？

1. **加表五件套**（做过 12+ 次迁移）：`lib/db/schema/*.ts` 模型 → 手写幂等 SQL → Makefile 的 `migrate` **和** `migrate-supabase` 两个 target → `lib/db/` 查询模块 → authz guard。漏掉任何一件都出过问题（最常漏 Makefile 的第二个 target）。→ **`add-db-table` skill**
2. **新 API 路由骨架**：`withAuth` + `parseUuidParam` + guard + `success()/error()` 信封。→ **`new-api-route` skill**
3. **功能切片顺序**：DB → 数据层+authz → API → UI → i18n，每层一个 commit。→ **`feature-slice` skill**
4. **i18n / UI 规范补漏**：`fix(chat): route model picker text through i18n`、`cursor-pointer pass`、语义 token 修正——同样的四条规则反复被事后修。→ **`ui-conventions-audit` skill**
5. **检索改动 + eval 对比**：每次动 `lib/rag/*` 都要跑一遍 eval 前后对比。→ **`rag-eval-loop` skill**
6. **文档同步**：CLAUDE.md / AGENTS.md / 双语 README / Architecture.md / RAG_pipeline.md 与代码对齐。→ **`sync-docs` skill**
7. **收尾验证**：build + lint + 流式竞态手测 + 死代码清理。→ **`ship-check` skill**

## 3. 哪些指令我总是手动重写？

CLAUDE.md 里沉淀的规则，正是曾经每次都要在 prompt 里重复说的话；而事后补漏 commit 证明**光写在 CLAUDE.md 里还不够**——需要变成收尾时强制执行的检查清单：

- 「所有字符串走 i18n，en/zh 都要加，包括 aria-label」
- 「可点击元素加 cursor-pointer」
- 「只用语义 token，不要 text-gray-800 / bg-white」
- 「API 必须返回 `{ requestId, ok, data?, error? }`」
- 「KB 相关路由必须过 `lib/authz/access.ts` 的 guard，跨租户返回 404」
- 「迁移手写 SQL，drizzle-kit 不生成；两个 Makefile target 都要加」
- 「不加新路由、不加新依赖、零配置可运行」
- 「没有单测，用 `pnpm build` 兜底类型」

这些现在全部编码进了对应 Skill 的 checklist，收尾时由 `ship-check` 统一兜底。

## 4. 哪些工作流程应该变成可复用的 Skills？

已落地在 `.claude/skills/`（Claude Code 会自动发现并按 description 触发）：

| Skill | 触发场景 |
| --- | --- |
| `add-db-table` | 任何 schema 变更 |
| `new-api-route` | 新增/修改 API 端点 |
| `feature-slice` | 跨层的用户功能 |
| `ui-conventions-audit` | 任何 UI 改动收尾前；或主动说「i18n 补漏」 |
| `rag-eval-loop` | 动 `lib/rag/*`、prompt、检索参数 |
| `sync-docs` | 功能落地后；或主动说「同步文档」 |
| `write-adr` | 难回退的决策、或刻意否决某方案时 |
| `ship-check` | 每个非平凡改动提交前 |

## 5. 过去哪些方法和思路是错的，应当避免？

从历史里能直接读出的教训（均有 commit 证据）：

1. **大爆炸式 UI 重设计**。PR #4 一次性重设计全站 → 被 #5 整体 revert → #6 重做。教训：重设计拆成小的可 review 的 pass；样式改动与行为改动分开；先在一个页面试点再铺开。
2. **规范事后补**。i18n / cursor-pointer / 语义 token 至少产生了 6 个专门的 fix commit。教训：规范检查属于**同一个 PR 的收尾步骤**（`ui-conventions-audit`），不是下一个 PR 的内容。
3. **多租户后补**。单用户 schema 先跑起来，workspace 租户后补，代价是 migration 010 的 backfill + 一整个「repo 级 guard 强制执行」commit（0a74d61）。教训：任何新资源在**数据层设计时**就确定租户锚点和 guard，不留白。
4. **想让 ORM 生成迁移**。pgvector / HNSW / partial unique index / DO $$ 回填让 drizzle-kit 生成的 SQL 不可用（ADR-004）。教训：本仓库迁移永远手写；drizzle 只做类型。
5. **流式边界想当然**。停止时追加 "[Stopped]" 污染答案（ec64729 修复）、水合检查顺序错误导致新会话自我取消（7075bbf 修复）。教训：动流式代码必须手测三个竞态：中途停止、regenerate、流式中开新会话。
6. **死代码随手留**。删功能不删翻译 key / state / helper，攒出了专门的清理 commit（ee51084）。教训：删除与替换在同一个 change 里完成。
7. **文档等到腐烂再救**。5 次专门的 docs 同步 commit 说明「以后再补文档」的默认策略是错的。教训：docs 同步进功能 PR，`sync-docs` 只是兜底。
8. **依赖环境的隐式假设**。`next/font/google` 在受限网络下失败，换成 CSS font vars（d2d94c9）；turbopack root 需要显式 pin（778abf）。教训：「零额外配置可运行」是硬约束，任何构建期外部网络依赖都是隐患。

## 6. Opus 需要知道什么？

见 `docs/claude/OPUS_SYSTEM_PROMPT.md`。核心思路：Fable 5 的优势在于**判断力**——知道何时停下来问、何时跑 eval、何时怀疑自己。给 Opus 的指令把这些判断显式化为规则和检查清单：架构不变量（信封/guard/迁移/i18n）、固定的切片顺序、强制的收尾清单、以及一份「历史上被否决的方案」清单防止重新发明。配合本目录的 Skills，Opus 按清单执行即可覆盖约九成日常产出。
