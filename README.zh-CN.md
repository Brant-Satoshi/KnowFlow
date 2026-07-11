# KnowFlow

> [English](./README.md) · **简体中文**

一个基于 Next.js（App Router）的 RAG 文档问答应用。把文档上传到知识库后，提问得到带行内引用的流式回答，引用可直接定位到来源 chunk。

技术栈：Next.js 16（React 19）· PostgreSQL + pgvector（Supabase 托管）· OpenRouter（chat + embeddings + Cohere rerank）· Supabase Storage（文件 blob）· Tailwind v4 + Radix UI。

多租户：会话 cookie 认证；每个知识库归属一个 workspace，支持 owner/admin/member 角色、邀请链接，首页带 workspace 切换器。

---

## 快速开始

```bash
pnpm install
cp .env.local.example .env.local   # 然后按下方表格填入密钥
pnpm dev                            # http://localhost:3000
```

> 使用 **pnpm**，不要用 npm。

类型检查走 `pnpm build`（没有单独的 `tsc` 脚本）。

### 必填环境变量

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | Postgres 连接串（必须装了 `pgvector`） |
| `OPENROUTER_API_KEY` | chat / embedding / rerank 共用同一个 OpenRouter key |
| `OPENROUTER_BASE_URL` | 默认 `https://openrouter.ai/api/v1` |
| `OPENROUTER_CHAT_MODEL` | 当前端 picker 未选模型时的兜底；否则走 catalog 默认（`lib/llm/catalog.ts`） |
| `OPENROUTER_EMBEDDING_MODEL` | 默认 `text-embedding-3-small` |
| `OPENROUTER_EMBEDDING_DIMENSIONS` | `text-embedding-3*` 默认 1536 |
| `OPENROUTER_RERANK_MODEL` | 默认 `cohere/rerank-v3.5` |
| `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 上传文件 blob 用的 Supabase Storage |

可选：
- `RERANK_ENABLED=false` —— 关掉 rerank 阶段
- `HYBRID_SEARCH_ENABLED=true` —— 用 RRF 把 pg_trgm 关键词腿融合进聊天召回（默认关闭；eval 显示当前数据集上无收益，见 ADR-010）

> **Embedding 必须是 1536 维。** `chunks.embedding` 列是 `vector(1536)`，代码每次调用都会校验维度。

### 初始化数据库

migrations 在 `db/migrations/` 下。迁移目标默认走名为 `knowflow-postgres` 的本地 Docker Postgres 容器；demo seed 直接使用 `DATABASE_URL`，所以本地或远程 Postgres 都可以使用同一命令：

```bash
make migrate     # 把 001_init … 013_add_trgm_keyword_search 跑到容器里
make seed        # 固定 demo 账号 + 奥林匹斯双语知识库
```

如果指向 Supabase / 远程 Postgres，跑 `make migrate-supabase`（用 `psql` 对 `DATABASE_URL` 应用同一批文件；migrations 幂等，可重复执行）。

`make seed` 会向量化仓库内的 `sample.txt` / `sample-zh.txt`，并且只替换 `demo@knowflow.local`，不会清空其他账号。完成后会打印登录信息和固定 KB id；可用 `DEMO_SEED_EMAIL`、`DEMO_SEED_PASSWORD` 覆盖 demo 凭据。`pnpm seed:demo -- --dry-run` 只校验 fixture/chunk 数，不访问网络也不写数据库。

---

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | Next dev server，`localhost:3000` |
| `pnpm build` | 生产构建（也充当类型检查） |
| `pnpm start` | 跑构建产物 |
| `pnpm lint` | ESLint |
| `pnpm test:unit` | Node 内置单元测试（`lib/**/*.test.ts`） |
| `pnpm test:e2e` | Playwright 端到端测试（`tests/`） |
| `pnpm seed:demo` | 幂等创建 demo 登录和已索引的双语 KB |
| `pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid>` | 对比 vector / hybrid 的质量与延迟 |

---

## 页面路由

固定 5 个，不再增加：

- `/` —— 知识库列表（CRUD），含 workspace 切换器 / 成员 / 加入对话框
- `/knowledge-bases/[id]/chat` —— 单个 KB 内的 RAG 聊天
- `/eval` —— 离线评测面板
- `/login`、`/register` —— 认证

API 接口在 `app/api/` 下（auth、workspaces、knowledge bases、files、conversations、RAG search、chat stream、eval run）。完整清单见 `Architecture.md`。

---

## 一次 chat 请求的流程

`POST /api/chat/stream`（SSE）：

1. embedding 用户 query（`lib/rag/embeddings.ts`）
2. 通过 `lib/rag/retrieve.ts` 召回 top-20：默认纯向量；实验开关 `HYBRID_SEARCH_ENABLED=true` 时用 RRF 融合向量腿与 pg_trgm 关键词腿；两种模式共用 KB scope 和过滤器
3. 走 Cohere/OpenRouter rerank，保留 top-8（`lib/rag/rerank.ts`）
4. 再切前 5 作为证据包
5. 构造带引用约束的 prompt，流式返回 token（`lib/llm/chat.ts`）

SSE 事件顺序：`progress*` → `meta` → `progress` → `token*` → `done`（或 `error`）；会话标题自动生成时额外推送 `title` 事件。每个事件都带 `requestId`。

hybrid 仍是默认关闭的实验功能：可复现的 `olympus-zh` A/B 显示命中率与 Recall@5 都没有提升；原始排序指标有升有降，生产 rerank 后质量基本持平，而本轮平均延迟增加 11.7%、p50 增加 18.7%。详见[实测 A/B 报告](./docs/evals/hybrid-ab-2026-07-10.md)与 [ADR-010](./docs/adr/010.hybrid-search-rrf-gated.md)。

### 检索 metadata 过滤器

`POST /api/chat/stream`、`/api/rag/search`、`/api/eval/run` 都接受可选的 `filter` 对象，在 rerank 之前先收窄向量检索范围（chat 与 eval 页面均有 UI 入口；eval run 会把过滤器持久化到 `eval_runs.filter`）：

```jsonc
{
  "filter": {
    "fileIds": ["<uuid>", "..."],        // 最多 50 个，OR 关系
    "fileTypes": ["pdf", "markdown"],    // pdf | markdown | word | text（按文件扩展名匹配），OR 关系
    "titleQuery": "第三章"                // 对 document/section title 做大小写不敏感的子串匹配，最长 200 字符
  }
}
```

维度之间是 AND，维度内部是 OR。校验逻辑在 `parseRetrievalFilter`（`lib/validation.ts`）；过滤器最终编译成 `searchChunks`（`lib/db/chunks.ts`）里额外的 SQL `WHERE` 条件。

---

## 项目约定

- **API 响应结构**：所有接口走 `lib/api/response.ts`，统一返回 `{ requestId, ok, data?, error? }`。
- **i18n**：JSX 与 `aria-label` 里禁止硬编码中英文 —— 文案统一在 `lib/i18n/translations.ts`（`en` 与 `zh` 同时维护）。
- **可交互元素**（`button`、`a`、可点击的 `div`）必须加 `cursor-pointer`。
- **不增加新的顶层路由**、**不引入新 npm 依赖**、**未明确要求时不改 DB schema 与 API 响应结构**。

完整约定见 `CLAUDE.md`；设计理由、关键权衡与失败策略见 `Architecture.md`。
