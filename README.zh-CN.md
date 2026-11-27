# KnowFlow

> [English](./README.md) · **简体中文**

一个基于 Next.js（App Router）的 RAG 文档问答应用。把文档上传到知识库后，提问得到带行内引用的流式回答，引用可直接定位到来源 chunk。

**在线演示：**<https://ai-rag-app-ashen.vercel.app>，用 `demo@knowflow.local` / `KnowFlowDemo2026!` 登录后，在知识库 Olympus Demo 里可以问“奥林匹斯计划的首席研究员是谁？”演示账号是公用的，数据可能被重置。

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

### Python API（可选）

首次使用时，在仓库根目录创建 Python 虚拟环境并安装依赖：

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/python -m pip install -r services/api/requirements.txt
```

之后只需要在仓库根目录运行 `pnpm dev:api`：自动读取 `.env.local`（已导出的环境变量优先），使用该虚拟环境在 `http://127.0.0.1:8000` 启动 FastAPI，并监听 Python 代码修改。健康检查地址是 `/api/health`，按 `Ctrl+C` 停止。端口被占用时可用 `pnpm dev:api --port 8001`。

也可以改用 Docker 跑同一个服务：在仓库根目录运行 `make api-docker`，它会用 `services/api/Dockerfile` 构建镜像，并在 `http://localhost:8000` 启动容器；按 `Ctrl+C` 停止，容器随之删除。密钥在启动时从 `.env.local` 读取，不会打进镜像。容器里的 `localhost` 指容器自己，所以 `DATABASE_URL` 里的 `localhost` 或 `127.0.0.1` 会被换成 `host.docker.internal`；Supabase 这类远程地址原样传入。Docker 按字面读取 `.env.local`，值的外面不能加引号。容器不会随代码修改自动重载，改完代码要重新运行这条命令。端口被占用时可用 `make api-docker API_PORT=8001`。

Python 服务目前独立运行，Next.js 仍用 `pnpm dev` 启动。检索需要可用的数据库和下方的 OpenRouter 配置。

`POST /api/chat/agent` 只有 Python 服务有。它不走“先检索、再回答”的固定流程，而是由模型（经 OpenRouter 调用 `deepseek/deepseek-chat-v3.1`）决定用什么词检索、检索几次。服务端在请求指定的知识库里执行每次检索（向量召回、重排、取前 5 个），最后一次性返回完整回答，不是流式。请求体是 `{ "message", "knowledgeBaseId", "conversationId"? }`，请求要带 `rag_session` cookie。带了会话时，读取它最近 8 条消息作为历史，这一轮的问答不写回会话。`data` 里有 `answer`、`citations`、`refusal`、`completed`、`stopReason` 和 `steps`（每次模型调用、每次工具调用各一条记录）。没答完也返回 200，`completed` 为 `false`。循环规则见 [ADR-013](docs/adr/013.fastapi-service-foundation.md)：模型必须先检索再回答，30 秒内最多调用 4 次模型，每次检索都为空时由程序拒答。

### MCP（Claude Desktop，stdio）

`services/api/mcp_server.py` 将 Python `/api/rag/search` 暴露为只读工具 `knowflow_search`，沿用 API 的会话和知识库权限检查。工具参数为 `query`，以及可选的 `topK`（默认 5，范围 1–20）、`maxDistance`（默认 1.0，范围 0–1）、`rerank`（默认 false）。知识库不是工具参数，而是来自客户端配置里的 `KNOWFLOW_KNOWLEDGE_BASE_ID`，模型无法选择；这和 Agent 接口从请求里绑定知识库是同一条规则。目前只支持向量检索；不支持 keyword、hybrid、fileId 或 filter。

1. 在现有虚拟环境中安装可选依赖：`services/api/.venv/bin/python -m pip install -r services/api/requirements-mcp.txt`。
2. 运行 `pnpm dev:api`，并保持终端运行。
3. 登录与 Python API 使用同一数据库的 KnowFlow，在浏览器开发者工具的 Application / Storage → Cookies 中找到 `rag_session`，复制它的值。只在本地配置中填写，不提交凭证；会话过期或登出后需重新配置。
4. 在 Claude Desktop 的 Settings → Developer → Edit Config 中，将下面的 `knowflow` 条目合并到已有的 `mcpServers`。macOS 配置文件位于 `~/Library/Application Support/Claude/claude_desktop_config.json`。将示例中的两处仓库路径替换成你的绝对路径，填写会话值，并填写知识库 UUID（可从 KnowFlow 的 `/knowledge-bases/<UUID>/chat` 地址取得）。一个条目只检索一个知识库；要用多个，就按知识库各加一个不同名字的条目。

```json
{
  "mcpServers": {
    "knowflow": {
      "command": "/absolute/path/to/knowflow/services/api/.venv/bin/python",
      "args": ["/absolute/path/to/knowflow/services/api/mcp_server.py"],
      "env": {
        "KNOWFLOW_API_URL": "http://127.0.0.1:8000",
        "KNOWFLOW_SESSION_TOKEN": "<rag_session value>",
        "KNOWFLOW_KNOWLEDGE_BASE_ID": "<知识库 UUID>"
      }
    }
  }
}
```

完全退出并重新打开 Claude Desktop，它会通过 stdio 自动启动 MCP 子进程；不需要手动启动 MCP 或为它分配端口。然后发送：“请用 knowflow_search 检索关于登录的内容，并引用来源。”接口地址、会话和知识库只来自客户端的环境配置，不是工具参数；未配置会话时仍可发现工具，但调用会提示配置凭证。

成功结果保留 `{ requestId, ok, data }`，提供结构化结果和文本回退；空片段是成功结果，401、404、超时等使用 MCP 工具错误。MCP 不生成答案，交给 Claude 根据片段回答。stdout 专供 MCP 协议，日志写 stderr；不要将入口命名为 `mcp.py`，否则会遮住 SDK 包。

验证：`services/api/.venv/bin/python -m pytest services/api/test_mcp_server.py -q`。测试使用模拟 HTTP 响应和真实 stdio 子进程，不访问数据库或模型；未安装可选 SDK 时跳过。客户端配置参考 [MCP 官方指南](https://modelcontextprotocol.io/docs/develop/connect-local-servers)。

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
make migrate     # 把 001_init … 014_managed_eval_datasets 跑到容器里
make seed        # 固定 demo 账号 + 奥林匹斯双语知识库 + 内置评测集
```

如果指向 Supabase / 远程 Postgres，跑 `make migrate-supabase`（用 `psql` 对 `DATABASE_URL` 应用同一批文件；migrations 幂等，可重复执行）。

`make seed` 会向量化仓库内的 `sample.txt` / `sample-zh.txt`，并且只替换 `demo@knowflow.local`，不会清空其他账号。它还会创建内置评测集 `olympus` / `olympus-zh`——仅在同名评测集不存在时创建，已被编辑过的评测集绝不会被还原成模板。完成后会打印登录信息和固定 KB id；可用 `DEMO_SEED_EMAIL`、`DEMO_SEED_PASSWORD` 覆盖 demo 凭据。`pnpm seed:demo -- --dry-run` 只校验 fixture/chunk 数，不访问网络也不写数据库。

---

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | Next dev server，`localhost:3000` |
| `pnpm dev:api` | Python FastAPI，`127.0.0.1:8000`；自动加载 `.env.local` 并热重载 |
| `pnpm build` | 生产构建（也充当类型检查） |
| `pnpm start` | 跑构建产物 |
| `pnpm lint` | ESLint |
| `pnpm test:unit` | Node 内置单元测试（`lib/**/*.test.ts`） |
| `pnpm test:e2e` | Playwright 端到端测试（`tests/`） |
| `pnpm seed:demo` | 幂等创建 demo 登录、已索引的双语 KB 和内置评测集 |
| `pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid> --dataset-id=<uuid>` | 对比 vector / hybrid 的质量与延迟 |

---

## 页面路由

固定 5 个，不再增加：

- `/` —— 知识库列表（CRUD），含 workspace 切换器 / 成员 / 加入对话框
- `/knowledge-bases/[id]/chat` —— 单个 KB 内的 RAG 聊天
- `/eval` —— 离线评测面板，含可管理的评测集（新建/编辑/JSON 导入、对知识库校验、按内容 hash 对比运行）
- `/login`、`/register` —— 认证

API 接口在 `app/api/` 下（auth、workspaces、knowledge bases、files、conversations、RAG search、chat stream、eval datasets 与 runs）。完整清单见 `Architecture.md`。

---

## 一次 chat 请求的流程

`POST /api/chat/stream`（SSE）：

1. embedding 用户 query（`lib/rag/embeddings.ts`）
2. 通过 `lib/rag/retrieve.ts` 召回 top-20：默认纯向量；实验开关 `HYBRID_SEARCH_ENABLED=true` 时用 RRF 融合向量腿与 pg_trgm 关键词腿；两种模式共用 KB scope 和过滤器
3. 走 Cohere/OpenRouter rerank，保留 top-8（`lib/rag/rerank.ts`）
4. 再切前 5 作为证据包
5. 构造带引用约束的 prompt，流式返回 token（`lib/llm/chat.ts`）

SSE 事件顺序：`progress*` → `meta` → `progress` → `token*` → `done`（或 `error`）；会话标题自动生成时额外推送 `title` 事件。每个事件都带 `requestId`。

hybrid 仍是默认关闭的实验功能：可复现的 `olympus-zh` A/B 显示命中率与 Hit@5（旧口径） 都没有提升；原始排序指标有升有降，生产 rerank 后质量基本持平，而本轮平均延迟增加 11.7%、p50 增加 18.7%。详见[实测 A/B 报告](./docs/evals/hybrid-ab-2026-07-10.md)与 [ADR-010](./docs/adr/010.hybrid-search-rrf-gated.md)。

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
