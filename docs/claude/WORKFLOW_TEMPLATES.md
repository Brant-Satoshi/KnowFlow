# 工作流模板（可直接粘贴的 Prompt 模板）

配合 `.claude/skills/` 使用：模板负责把任务说清楚，Skill 负责把过程做对。
`{...}` 为占位符。

---

## T1 · 全栈新功能

```
实现功能：{一句话描述}。
范围：{涉及的页面/端点}；不改 {明确排除项}。
按 feature-slice skill 的顺序做（DB → 数据层+authz → API → UI → i18n），每层一个 commit。
新资源的租户锚点：{挂在哪个 KB/workspace 外键链上}。
完成后跑 ship-check，汇报跳过了哪些检查及原因。
```

## T2 · UI 打磨（避免大爆炸重设计）

```
只改 {页面/组件} 的 {具体方面：间距/配色/布局}。
分成 ≤{N} 个独立可 revert 的 commit，每个 commit 只做一类视觉改动，不夹带行为变更。
先给我看第一个页面的效果描述/截图再继续铺开。
收尾跑 ui-conventions-audit（深浅两主题 + 中英两语言都确认）。
```

## T3 · 加表 / 改 schema

```
需求：{表/列 + 用途}。走 add-db-table skill 的四件套。
迁移必须幂等；KB 级数据写明 FK 链；同步更新 CLAUDE.md 的表清单和数量。
不要用 drizzle-kit 生成迁移。
```

## T4 · 检索/RAG 调优

```
假设：{改动} 能提升 {指标}。
走 rag-eval-loop：先在 {数据集/KB} 上跑 baseline，改动后同条件重跑，给我逐项指标对比表。
指标回退也要如实报告。改动收敛在 lib/rag/retrieve.ts / RETRIEVAL 配置内。
```

## T5 · 重构 / 去重

```
目标：{要消除的重复或要收拢的边界}。
行为不变：pnpm build + lint 必须过，公开 API 信封和路由签名不动。
顺手删掉被替代的死代码（含 i18n key）。每个内聚的重构一个 commit。
```

## T6 · 文档同步

```
把 {CLAUDE.md / README 双语 / Architecture.md / RAG_pipeline.md} 与当前代码对齐（sync-docs skill）。
每条修正都要有代码依据（文件:行），不要凭记忆写数字。只除锈，不加新章节。
```

## T7 · Bug 修复

```
现象：{复现步骤 + 期望 vs 实际}。
先定位根因并向我解释，再修。修复最小化；若涉及流式，手测三竞态（停止/regenerate/新会话）。
如果根因是设计问题而非实现问题，先停下来说明，不要打补丁。
```

## T8 · 记录决策

```
我们刚决定 {决策}，否决了 {备选}，原因是 {真实原因}。
按 write-adr skill 写 ADR-{NNN}（中文主文 + en/ 副本 + 两个 README 表格行）。
```
