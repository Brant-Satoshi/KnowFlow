# ai-rag-app

> [English](./README.md) · **简体中文**

一个基于 Next.js（App Router）的 RAG 文档问答应用。把文档上传到知识库后，提问得到带行内引用的流式回答，引用可直接定位到来源 chunk。

技术栈：Next.js 16（React 19）· PostgreSQL + pgvector（Supabase 托管）· MiniMax（chat + embeddings）· OpenRouter / Cohere（rerank）· Supabase Storage（文件 blob）· Tailwind v4 + Radix UI。

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
| `MINIMAX_API_KEY` | 默认的 LLM + embedding provider |
| `MINIMAX_BASE_URL` | 默认 `https://api.minimax.chat/v1` |
| `MINIMAX_EMBEDDING_MODEL` | 例如 `embo-01`（1536 维） |
| `MINIMAX_CHAT_MODEL` | 默认 `abab6.5-chat` |
| `OPENROUTER_API_KEY` | rerank 必需；也可作为 chat-provider 备选 |
| `OPENROUTER_RERANK_MODEL` | 默认 `cohere/rerank-v3.5` |
| `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 上传文件 blob 用的 Supabase Storage |

可选：
- `CHAT_PROVIDER=minimax|openrouter` —— 显式指定 chat provider（否则自动选第一个有 key 的）
- `OPENAI_EMBEDDING_MODEL`（配合 `OPENAI_BASE_URL`、`OPENAI_EMBEDDING_DIMENSIONS=1536`）—— 用 OpenAI 兼容的 embedding 接口替代 MiniMax
- `RERANK_ENABLED=false` —— 关掉 rerank 阶段

> **Embedding 必须是 1536 维。** `chunks.embedding` 列是 `vector(1536)`，代码每次调用都会校验维度。

### 初始化数据库

migrations 在 `db/migrations/` 下。`Makefile` 默认走名为 `ai-rag-postgres` 的本地 Docker Postgres 容器：

```bash
make migrate     # 把 001_init … 004_add_conversations 跑到容器里
make seed        # 可选 fixtures
```

如果指向 Supabase / 远程 Postgres，按顺序用你熟悉的客户端把 SQL 文件依次执行即可。

---

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | Next dev server，`localhost:3000` |
| `pnpm build` | 生产构建（也充当类型检查） |
| `pnpm start` | 跑构建产物 |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | Playwright 端到端测试（`tests/`） |

---

## 页面路由

固定 3 个，不再增加：

- `/` —— 知识库列表（CRUD）
- `/knowledge-bases/[id]/chat` —— 单个 KB 内的 RAG 聊天
- `/eval` —— 离线评测面板

API 接口在 `app/api/` 下（knowledge bases、files、conversations、RAG search、chat stream、eval run）。完整清单见 `Architecture.md`。

---

## 一次 chat 请求的流程

`POST /api/chat/stream`（SSE）：

1. embedding 用户 query（`lib/rag/embeddings.ts`）
2. 在该 KB 内做向量检索，取 top-20、cosine distance < 0.4（`lib/db/chunks.ts`）
3. 走 Cohere/OpenRouter rerank，保留 top-8（`lib/rag/rerank.ts`）
4. 再切前 5 作为证据包
5. 构造带引用约束的 prompt，流式返回 token（`lib/llm/chat.ts`）

SSE 事件顺序：`progress*` → `meta` → `progress` → `token*` → `done`（或 `error`）。每个事件都带 `requestId`。

---

## 项目约定

- **API 响应结构**：所有接口走 `lib/api/response.ts`，统一返回 `{ requestId, ok, data?, error? }`。
- **i18n**：JSX 与 `aria-label` 里禁止硬编码中英文 —— 文案统一在 `lib/i18n/translations.ts`（`en` 与 `zh` 同时维护）。
- **可交互元素**（`button`、`a`、可点击的 `div`）必须加 `cursor-pointer`。
- **不增加新的顶层路由**、**不引入新 npm 依赖**、**未明确要求时不改 DB schema 与 API 响应结构**。

完整约定见 `CLAUDE.md`；设计理由、关键权衡与失败策略见 `Architecture.md`。
