# 架构决策记录

每个重要且难以回退的决策使用一个文件记录。格式沿用 ADR-001：
状态 / 背景 / 决策 / 备选方案 / 取舍 / 影响 / 备注。新增记录命名为
`NNN.slug.md`。

英文版本保留在 [en/](./en/README.md)。

| ADR | 决策 | 关键取舍 |
| --- | --- | --- |
| [001](./001.use-streaming.md) | 使用 SSE + 客户端 buffer/flush 实现流式输出 | 更顺滑的流式体验 vs 单向传输 + 手动缓冲控制 |
| [002](./002.pgvector-in-postgres.md) | 将向量存储在 Postgres 中（pgvector + HNSW） | 一个事务型存储 vs 全局 ANN 索引后按租户过滤 |
| [003](./003.two-stage-retrieval.md) | 向量召回 top-20 → Cohere rerank → top-5 | cross-encoder 精度 vs 每条消息额外一次 API 跳转（可用特性开关控制） |
| [004](./004.handwritten-sql-migrations.md) | 手写幂等 SQL；Drizzle 仅用于类型 | 完整 DDL 控制 vs 同时维护 schema.ts 和 .sql |
| [005](./005.openrouter-single-gateway.md) | 使用 OpenRouter 作为 chat/embed/rerank 的统一网关 | 一个密钥 + 基于目录切换模型 vs 额外跳转 + 包装后的错误 |
| [006](./006.opaque-db-sessions.md) | 使用不透明数据库 session，而不是 JWT | 即时撤销 vs 每个请求一次数据库读取 |
| [007](./007.workspace-tenancy-app-guards.md) | 共享 schema 多租户、应用层 guard、404 防枚举 | 显式且可审计的 guard vs 每个路由都必须记得调用（无 RLS） |
| [008](./008.invite-code-collaboration.md) | 可多次使用且会过期的邀请码 | 无邮件基础设施 + 通过操作表达同意 vs 带外 token 处理 |
| [009](./009.hand-rolled-i18n.md) | 手写带类型的 en/zh 字典 | 编译期检查 key、零依赖 vs 无 ICU/复数能力 |
| [010](./010.hybrid-search-rrf-gated.md) | 混合检索（RRF 融合向量 + 关键词），默认关闭 | 落地可开关的能力 vs eval 在现有数据集上显示零收益，故不默认打开 |
| [011](./011.refuse-on-empty-retrieval.md) | 检索为空时由代码拒答；rerank 分数下限不采用（默认 0） | 空召回不再可能编造 vs 分数无法区分"可回答性"，下限只会误拒真问题 |
