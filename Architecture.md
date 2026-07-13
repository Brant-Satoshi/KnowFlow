# RAG 文档问答系统 Architecture

## 1. 产品目标与边界

### 目标用户

* 需要对**内部资料/项目文档/规范**快速查找与问答的用户（研发/运营/客服/产品/管理者）。
* 典型任务：在一堆文档中定位依据、总结要点、生成可追溯的回答。

### 核心场景

1. **基于知识库的问答**：用户选择一个 Knowledge Base，在其内提问，得到"可引用"的回答。
2. **证据回溯**：回答中的 `[1] [2]` 编号可点开来源（文件 + chunk 片段 + page）。
3. **离线评测**：用知识库内的代表性 chunk 自动生成题集，对比 with/without rerank 的检索与引用命中率。

### 明确不做（当前范围外）

* 不做模型训练/微调；优先做工程化约束与可靠性闭环。
* 不承诺"全知回答"；**缺证据时必须拒答**（提示"I couldn't find relevant information in the knowledge base."）。
* 权限模型止步于 workspace 级（session 认证 + owner/admin/member 角色 + 邀请制协作，见 ADR 006/007/008）；不做更细粒度的 KB 级 ACL。
* 不增加新的顶层页面路由（固定为 `/`、`/knowledge-bases/[id]/chat`、`/eval`、`/login`、`/register` 五个）。

---

## 2. 端到端架构图（文字版）

```
[Browser/Client]
  ├─ /                              (Knowledge Base 列表 / CRUD + workspace 切换/成员/加入对话框)
  ├─ /knowledge-bases/[id]/chat     (RAG Chat：SSE 流式、Abort、引用面板)
  ├─ /eval                          (题集跑分 + with/without rerank 对比)
  └─ /login、/register              (认证)

        │ HTTPS (JSON) + SSE (text/event-stream)
        ▼

[Next.js Route Handlers — app/api/*]
  ├─ /api/auth/*                     (register / login / logout / me，session cookie)
  ├─ /api/workspaces/*               ([id] / members / invites / join / leave)
  ├─ /api/knowledge-bases            (GET / POST / [id] GET/PUT/DELETE)
  ├─ /api/files                      (GET 列表)
  ├─ /api/files/upload               (POST 上传 → Supabase Storage + DB)
  ├─ /api/files/[id]                 (GET / DELETE，DELETE 同时清 storage + chunks)
  ├─ /api/files/[id]/chunks          (GET 该文件的分块)
  ├─ /api/files/[id]/parse           (POST 解析+分块+向量化)
  ├─ /api/conversations              (GET / POST，挂在 KB 下)
  ├─ /api/conversations/[id]         (GET / PATCH / DELETE)
  ├─ /api/conversations/[id]/messages(GET / POST 历史消息)
  ├─ /api/rag/search                 (POST 纯检索，调试/eval 用，支持 RetrievalFilter 与 mode: vector | keyword | hybrid)
  ├─ /api/chat/stream                (POST SSE：progress → meta → token* → done|error，+title)
  ├─ /api/eval/run                   (POST 跑 curated 题集 + 双跑对比，支持 RetrievalFilter)
  ├─ /api/eval/runs、runs/[id]       (GET 历史 run 列表 / 详情)
  └─ /api/eval/validate              (POST 校验数据集)

  统一响应：{ requestId, ok, data?, error? }（见 lib/api/response.ts）
  KB 相关路由统一经 lib/authz/access.ts 守卫（跨租户 404，匿名 401）

        │
        ├──────────────┬────────────────────┬────────────────────┐
        ▼              ▼                    ▼                    ▼

[Supabase Storage]  [PostgreSQL]         [pgvector (HNSW)]     [外部模型服务]
 (上传原文)         users / sessions      chunks.embedding       OpenRouter（单网关：
                    workspaces/members/   vector(1536) +          chat + embedding +
                      invites             hnsw vector_cosine_ops  Cohere rerank）
                    knowledge_bases
                    files / chunks
                    conversations/messages
                    eval_*（4 张）

        ▲              ▲                    ▲                    ▲
        └──────────────┴── requestId 串联日志 + stage progress ──┘
                 (search_ms, llm_ms, recalledCount, finalCount, error_code)
```

---

## 3. 核心模块结构

### 3.1 API Routes（实际现状）

```
app/api/
├── auth/
│   ├── register/route.ts       # POST 注册（自动建默认 workspace）
│   ├── login/route.ts          # POST 登录 → session cookie
│   ├── logout/route.ts         # POST 登出
│   └── me/route.ts             # GET 当前用户
├── workspaces/
│   ├── route.ts                # GET 我的 workspace 列表 / POST 创建
│   ├── join/route.ts           # POST 凭邀请码加入
│   └── [id]/
│       ├── route.ts            # GET / PATCH / DELETE
│       ├── members/            # GET 列表；[userId] PATCH 改角色 / DELETE 移除
│       ├── invites/            # GET / POST；[inviteId] DELETE 撤销
│       └── leave/route.ts      # POST 退出
├── knowledge-bases/
│   ├── route.ts                # GET 列表 / POST 创建
│   └── [id]/route.ts           # GET / PUT / DELETE
├── files/
│   ├── route.ts                # GET 列表
│   ├── upload/route.ts         # POST 上传 → Supabase Storage + files 行
│   └── [id]/
│       ├── route.ts            # GET / DELETE（级联清 storage + chunks）
│       ├── chunks/route.ts     # GET 该文件分块
│       └── parse/route.ts      # POST 解析 → 分块 → embedding → indexed
├── conversations/
│   ├── route.ts                # GET (?knowledgeBaseId=) / POST
│   └── [id]/
│       ├── route.ts            # GET / PATCH (rename) / DELETE
│       └── messages/route.ts   # GET 历史 / POST 追加
├── rag/
│   └── search/route.ts         # POST vector / keyword / hybrid 检索（调试 / eval）
├── chat/
│   └── stream/route.ts         # POST SSE 流式问答（核心）
└── eval/
    ├── run/route.ts            # POST 跑 curated 题集 + rerank 双跑对比
    ├── runs/route.ts           # GET 历史 run 列表；[id]/route.ts GET 详情
    └── validate/route.ts       # POST 校验数据集
```

### 3.2 Core Libraries

```
lib/
├── api/response.ts             # 统一 { requestId, ok, data?, error? } + success()/error()
├── auth/                       # session cookie 认证（sessions / users / password / cookie / current-user）
├── authz/access.ts             # workspace 访问守卫（requireKnowledgeBaseAccess 等，跨租户 404）
├── chat/sse.ts                 # 客户端 SSE 解析
├── db/
│   ├── schema/                 # Drizzle ORM 模型（core.ts + eval.ts + auth.ts），仅供类型推断
│   ├── pg.ts                   # pg Pool + query/execute helpers
│   ├── supabase.ts             # Supabase 客户端 + STORAGE_BUCKET
│   ├── storage.ts              # 上传/删除文件 blob（Supabase Storage）
│   ├── knowledge-bases.ts      # KB CRUD
│   ├── files.ts                # 文件元数据 CRUD
│   ├── chunks.ts               # chunk CRUD + searchChunks (HNSW + KB 过滤 + RetrievalFilter)
│   ├── conversations.ts        # 会话 + 消息 CRUD
│   ├── workspaces.ts           # workspace / 成员 / 邀请持久化
│   └── eval.ts                 # eval 数据集/运行持久化
├── eval/                       # 数据集加载/校验、runner、LLM judge、指标计算
├── llm/                        # chat.ts（buildPrompt / streamLlmAnswer / generateAnswer）、catalog.ts（模型列表）、prompts.ts
├── rag/
│   ├── parse.ts                # PDF (pdf2json) / DOCX (mammoth) / MD / TXT 解析
│   ├── text.ts                 # 无副作用文本清洗（真实索引与 demo seed 共用）
│   ├── chunks.ts               # chunkSize + overlap 分块
│   ├── embeddings.ts           # OpenRouter（OpenAI 兼容 /embeddings，强校验 1536 维）
│   ├── reindex.ts              # 重建索引
│   └── rerank.ts               # OpenRouter → Cohere rerank-v3.5，失败回退原顺序
├── hooks/                      # use-chat-stream、use-file-state、use-error-toast
├── i18n/                       # LanguageContext + en/zh translations
├── telemetry/requestId.ts      # crypto.randomUUID()
├── types.ts                    # 共享类型（见下）
├── validation.ts               # isValidUuid / parseRetrievalFilter 等
└── utils.ts
```

---

## 4. 核心数据模型

### 4.1 数据库表（14 张：5 auth + 5 core + 4 eval，见 `db/migrations/`）

```sql
-- auth / workspace（lib/db/schema/auth.ts）
users             (id uuid PK, email UNIQUE, password_hash, created_at, updated_at)
sessions          (id text PK, user_id FK, created_at, expires_at)
workspaces        (id uuid PK, name, owner_id FK, created_at, updated_at)
workspace_members (workspace_id FK, user_id FK, role, created_at)  -- role: owner|admin|member
workspace_invites (id uuid PK, workspace_id FK, role, token UNIQUE, created_by FK, expires_at, created_at)

-- core（lib/db/schema/core.ts）
knowledge_bases (id uuid PK, user_id FK, workspace_id FK, name, description, created_at, updated_at)
files           (id uuid PK, name, type, size, status, knowledge_base_id FK NOT NULL, created_at)
chunks          (id text PK, file_id FK, idx, text, embedding_text, document_title, section_title, meta jsonb, embedding vector(1536))
conversations   (id uuid PK, knowledge_base_id FK, title, model, created_at, updated_at)
messages        (id uuid PK, conversation_id FK, role, content, retrieved_chunks jsonb, created_at)

-- eval（lib/db/schema/eval.ts）
eval_datasets   (id uuid PK, name UNIQUE, description, dataset_hash, revision, case_count, created_at, updated_at)
eval_cases      (id uuid PK, dataset_id FK, case_key, question, expected_keywords jsonb, category, difficulty, target_file_names jsonb, target_chunk_substrings jsonb, expected_answer, notes, idx)
eval_runs       (id uuid PK, knowledge_base_id FK, dataset_id FK NULL, dataset_name, dataset_hash, mode, use_rerank, total_cases, passed_cases, retrieval_hit_rate, citation_hit_rate, avg_latency_ms, recall_at_k jsonb, precision_at_k jsonb, ndcg_at_k jsonb, mrr, avg_faithfulness, avg_answer_relevance, filter jsonb)
eval_run_items  (id uuid PK, run_id FK, idx, case_key, question, passed, failure_reasons jsonb, retrieval_hit, citation_hit, latency_ms, retrieved_chunks jsonb, top_k_hits jsonb, answer, expected_answer, graded_hits jsonb, faithfulness, answer_relevance)

INDEX chunks_file_idx          ON chunks(file_id, idx)
INDEX chunks_embedding_hnsw    ON chunks USING hnsw (embedding vector_cosine_ops)
INDEX files_kb_idx             ON files(knowledge_base_id)
INDEX kb_created_idx           ON knowledge_bases(created_at DESC)
INDEX kb_user_idx / kb_workspace_idx ON knowledge_bases(user_id / workspace_id)
INDEX conversations_kb_idx     ON conversations(knowledge_base_id, updated_at DESC)
INDEX messages_conv_created_idx ON messages(conversation_id, created_at)
UNIQUE users_email_unique / workspace_invites_token_unique
UNIQUE workspace_members_single_owner_idx  -- 每个 workspace 恰好一个 owner
INDEX sessions_user_idx / sessions_expires_idx / workspaces_owner_idx / workspace_members_user_idx
INDEX eval_datasets_name_unique ON eval_datasets(name)  -- UNIQUE
INDEX eval_cases_dataset_idx   ON eval_cases(dataset_id, idx)
INDEX eval_cases_dataset_case_key_unique ON eval_cases(dataset_id, case_key)  -- UNIQUE（014）
INDEX eval_runs_kb_idx         ON eval_runs(knowledge_base_id, created_at)
INDEX eval_runs_hash_idx       ON eval_runs(knowledge_base_id, dataset_hash, created_at)
INDEX eval_run_items_run_idx   ON eval_run_items(run_id, idx)
```

**要点**

* `chunks.embedding` 在 002 之后**可空**——文件刚解析、还没向量化的中间状态。`searchChunks` 强制 `embedding IS NOT NULL`。
* `chunks.meta` 是 jsonb，持久化 `{ page?, start?, end? }`；检索时还会临时挂上 `_distance` 与 `_rerankScore`（不写回 DB）。
* `messages.retrieved_chunks` 是 jsonb 数组（`RetrievedChunk[]`），重打开会话时直接还原引用面板。
* **迁移约定**：Drizzle 模型在 `lib/db/schema/*.ts`，仅供 ORM 类型推断；手写 `db/migrations/0xx_*.sql` 才是 source of truth，经 `make migrate`（本地 Docker）或 `make migrate-supabase`（远程，走 `DATABASE_URL`）应用（`drizzle-kit` 不生成迁移，产物进 scratch `./drizzle`，见 `drizzle.config.ts`）。新增表须同时在 `Makefile` 的两个 migrate 目标各补一行（逐文件显式列出，无通配）。

### 4.2 共享类型（`lib/types.ts` 摘要）

```typescript
type FileDocStatus = 'uploaded' | 'parsing' | 'indexed' | 'failed';

interface Chunk {
  id: string; fileId: string; idx: number;
  text: string; meta: ChunkMeta;
  embedding?: number[]; fileName?: string;
}

interface RetrievedChunk {
  index: number;        // 1-based，对应 prompt 里的 [1][2]
  chunkId: string; fileId: string; fileName: string;
  page?: number; quote: string;        // text.slice(0, 300)
  score?: number; scoreType?: 'rerank' | 'vector' | 'keyword';
}
```

---

## 5. 关键链路设计

### 5.1 上传 → 解析 → 向量化

1. `POST /api/files/upload`：MIME 校验后写入 Supabase Storage（key = `<fileId><ext>`），同时插入 `files` 行（`status='uploaded'`，挂在指定 KB 下）。
2. `POST /api/files/[id]/parse`：状态置 `parsing` → 按 MIME 走解析（PDF→`pdf2json`，DOCX→`mammoth`，MD/TXT→纯文本）→ `chunkSize + overlap` 切片 → 批量 `embedChunk` → 事务里 `replaceFileChunks`（先删后插）→ 状态置 `indexed`。失败置 `failed` 并记原因。
3. 删除文件走 `/api/files/[id]` DELETE：同时清 Storage blob 与 `chunks`（外键 ON DELETE CASCADE 兜底）。

**设计要点**

* 分块 id 必须稳定可复现，引用才能持久有效。
* `meta.page` 是引用的最低保障——MVP 阶段只到 chunk/page 粒度，不做句级对齐。
* 解析+向量化目前**同步**完成；TODO：抽到队列里做异步重试。

---

### 5.2 检索 → 重排 → 生成（核心 RAG 链）

入口：`POST /api/chat/stream`（`app/api/chat/stream/route.ts`），SSE 响应。

```
1. embedText(query)                                         ← lib/rag/embeddings.ts
2. searchChunks(emb, topK=20, maxDistance=0.6, kbId,        ← cosine distance, HNSW
                filter?)                                      强制按 KB 过滤；可叠加
                                                              RetrievalFilter（fileIds/
                                                              fileTypes/titleQuery）
3. rerankChunks(query, recalled, { topN: 8 })               ← Cohere rerank-v3.5
   - 仅当 recalled.length > 1 才发请求
   - 任一异常（网络/4xx/无 results）回退到原召回顺序
4. finalChunks = reranked.slice(0, 5)                       ← 进 prompt 的"证据包"
5. buildPrompt(question, finalChunks)                       ← 强制 [n] 引用、缺证据拒答
6. streamLlmAnswer(...)                                     ← OpenRouter，模型 = 会话选择
                                                              → env → catalog 第一项；
                                                              fetch + 手动解析 SSE delta
7. onComplete → 落库 messages 行（含 retrievedChunks 快照）
```

**SSE 事件契约**（每个 event 都带 `requestId`）：

| event      | payload 关键字段 | 时机 |
| ---------- | --- | --- |
| `progress` | `stage: 'searching' \| 'searched' \| 'reranking' \| 'reranked' \| 'generating'`，附 `recalledCount` / `finalCount` / `rerankSkipped` | 阶段切换 |
| `meta`     | `retrievedChunks: RetrievedChunk[]` | 生成开始前 |
| `token`    | `delta: string` | 每个 token（按 `/\s+/` 切片 + 10ms 节流） |
| `done`     | `requestId` | 正常结束 |
| `error`    | `message` 或 `{ status, error }` | 任一阶段抛错 |
| `title`    | `conversationId, title` | 新会话首问时异步生成标题后推送 |

**设计要点**

* `topK=20` + `maxDistance=0.6` 是召回上限/阈值；rerank 把"精度"还回来。
* **拒答优先于编造**：prompt 显式要求"找不到就说找不到"，rerank 后证据不足时也走拒答分支。
* `history` 取最近 8 条且**在持久化新 user 消息之前**取（避免把当前消息当历史发回去）。
* `requestId` 客户端可传入并复用为 assistant 消息 id —— 流式中断后能精确定位到那条消息做 regenerate。

---

### 5.3 Eval（`/eval`）

评测集（goldset）**存储在数据库中**，全局归属（不挂 workspace/KB；任何登录用户可管理，跑 eval 仍需 `requireKnowledgeBaseAccess`）。管理面：`GET|POST /api/eval/datasets`、`GET|PATCH|DELETE /api/eval/datasets/[id]`、`POST .../cases`（对象=单条、数组=原子批量导入）、`PATCH|DELETE .../cases/[caseId]`（`[caseId]` 是行 UUID，业务键是 `caseKey`）。除创建外的所有写操作携带 `expectedRevision` 做乐观并发（`revision` 列在每次写——含改名/描述——时 +1，过期 → 409 `dataset_changed`），每次写在行锁内重算 `dataset_hash` / `case_count`（hash 只表示 case 内容、只用于 run 可比性）；上限 `MAX_GOLDSET_CASES = 50` 在创建/单条新增/导入三处强制。`pnpm seed:demo` 仅在同名评测集不存在时创建内置的 olympus / olympus-zh（模板在 `lib/eval/dataset.ts`）。见 ADR-011。

`POST /api/eval/run` 接收 `datasetId`：**一次快照**贯穿整个请求（断言存量 hash 与 cases 一致，不一致 → 500 `dataset_hash_mismatch`），先过两层校验（structural lint + filter 感知的 KB preflight，`lib/eval/validate.ts`），任一 error → 422 `dataset_incompatible` 拒跑；运行期间的编辑/删除不影响本次 run（删除后 run 以 `dataset_id = NULL` 保存，快照 name/hash 保留，孤儿 run 之间按 `dataset_hash` 相等仍可互比——`canCompare`，`lib/eval/goldset.ts`）；`saveRun` 失败整个 API 返回 500。可选叠加 `RetrievalFilter`，**双跑** with/without rerank，同时打分：

* `retrievalHit` —— 目标 chunk（target_file_names / target_chunk_substrings）是否出现在最终 top-5
* `topKHits` —— 在召回阶段 top-1 / top-3 / top-5 命中情况
* `citationHit` —— 答案里同时存在 `[n]` 引用 **且** 命中至少一个 expected keyword
* 排序指标 —— `recall@k` / `precision@k` / `ndcg@k` / `mrr`
* LLM judge（`lib/eval/judge.ts`）—— 逐 case 打 `faithfulness` / `answerRelevance`，聚合为 `avg_faithfulness` / `avg_answer_relevance`
* `latencyMs`、`avgLatencyMs`、`retrievalHitRate`、`citationHitRate`、`passedCases`

run 与逐 case 结果持久化到 `eval_runs` / `eval_run_items`（含所用 filter），历史可在 `/eval` 页面回看（`/api/eval/runs`）。

回归门禁：调整 chunkSize / topK / prompt / rerank 开关时，跑 `/eval` 比较 with vs without。

---

## 6. 关键权衡（Tradeoffs）

### 6.1 SSE vs WebSocket

* **选择 SSE**：单向流式、原生支持 abort、无握手开销，符合"输出 token + 偶发 progress"这种场景。
* 代价：服务端推送是单向的，反向通信靠的是客户端 abort（已实现）+ 服务端 `request.signal` 检测。

### 6.2 引用粒度：chunk 级 vs 句级

* **当前 = chunk 级**：`[1][2]` 直接指向证据包里的 chunk，量级稳定、prompt 简单。
* 代价：UI 高亮只能定位到 chunk 文本而不是具体句子。后续可加句子对齐 + offset 高亮。

### 6.3 召回阈值与 topK

* `topK=20 / maxDistance=0.6 / rerank topN=8 / final 5` —— 经验值。
* 太严：召回为空 → 拒答率虚高；太松：噪声进 prompt → 引用错位/幻觉。
* 调参靠 `/eval`，不靠人肉看几条结果。

### 6.4 是否启用 rerank

* **默认启用**（`RERANK_ENABLED=true`）。Cohere rerank-v3.5 把 20 条召回压到 8 条，再切前 5 进 prompt。
* `recalled.length ≤ 1` 直接跳过；网络/上游异常**静默回退**到原顺序——不让一次第三方故障打挂整条问答。
* 关掉后系统应仍可用（只是精度下降），这是底线。

### 6.5 严格拒答 vs "尽量回答"

* **选择严格拒答**：prompt 显式 "If the answer cannot be found in the context, say: I couldn't find relevant information in the knowledge base."
* 代价：观感不如"什么都答"，但可信度与引用一致性显著更高。

### 6.6 单 provider（OpenRouter）+ 运行时模型选择

* chat / embedding / rerank 三条链路统一通过 `lib/models.ts` 解析为 OpenRouter 配置，单 `OPENROUTER_API_KEY` 覆盖全部。
* chat 的具体 model 不再绑死 env：由 `lib/llm/catalog.ts` 维护一张 preset 列表，前端下拉框按对话切换；选中的 model id 持久化到 `conversations.model` 列。`resolveChatProvider(modelId?)` 接受可选参数,优先级为 参数 → `OPENROUTER_CHAT_MODEL` env → catalog 第一项。
* embedding / rerank 仍是 env-only —— 运行时切换 embedding provider 没意义（旧 chunk 向量空间不可比),要换必须重建索引。
* 没有引入 SDK，保留裸 `fetch`，错误信息可控、依赖最小。

---

## 7. 指标体系（Metrics & Observability）

### 7.1 体验指标

* **TTFT**：首个 `token` 事件距请求开始的时间（前端可直接计时）。
* **E2E Latency**：可拆分为 `progress(searching → searched)` / `progress(reranking → reranked)` / `progress(generating) → done` 三段——progress 事件就是为此设计的。
* **Stream Error Rate**：`error` 事件占比。
* **Abort Rate**：客户端主动 abort 占比，反映"答非所问/太啰嗦"。

### 7.2 RAG 质量指标（`/eval` 直接产出）

* `retrievalHitRate`、`citationHitRate`、`passedCases`、`avgLatencyMs`
* `topKHits`（top-1/3/5）：判断"模型答错"是召回问题还是排序问题

### 7.3 成本指标（待补）

* 当前 `streamLlmAnswer` 没记录 token 用量；OpenRouter 流式响应里有 usage 字段时可补一个 `tokens_in/out`。
* `Cost per conversation` 暂未实现。

### 7.4 观测约定

* 所有 API 响应：`{ requestId, ok, data?, error? }`。
* 服务端日志统一以 `[${requestId}]` 前缀，便于 grep 串联：
  ```
  [<requestId>] chat error: <stack>
  [<requestId>] onComplete failed: <stack>
  ```
* SSE 内每个事件也带 `requestId`，方便客户端把前后端日志对上。

---

## 8. 失败策略（Failure Modes & Fallbacks）

### 8.1 检索失败（无相关 chunk）

* `searchChunks` 受 `maxDistance=0.6` 卡控（叠加 RetrievalFilter 时更严），可能返回空数组。
* 空数组照样进 `rerankChunks` → 直接返回原（空）数组 → `buildPrompt` 把"Context: "留空 → LLM 按 system 指令输出"I couldn't find relevant information in the knowledge base."
* 客户端看到 `meta.retrievedChunks=[]` 即可触发"无引用"提示。

### 8.2 LLM 超时 / 限流 / 服务不可用

* `streamLlmAnswer` 检测 `!response.ok`：读取 body 后 `send('error', { requestId, status, error })`，**不抛**——避免 stream 半截断错。
* 客户端按 `error` 事件复位为 error 态，由用户决定重试。
* 多 provider 的硬切换还没实现（只有"启动时按 priority 选第一个有 key 的"）。

### 8.3 引用对不上（"编造引用"风险）

* prompt 强制只能用证据包里 `[1]..[5]` 的编号，没有就不写 `[n]`。
* 服务端**没做**事后校验（trim 不合法引用、标记 `citation_invalid`）——属于已知缺口。
* 兜底是 eval 阶段的 `citationHit`：长期看到下降就回滚 prompt / 召回参数。

### 8.4 流式中断（网络抖动 / 用户 abort）

* `request.signal` 透传给 embed / rerank / 上游 LLM fetch，全链路可中断。
* `finally` 里 `controller.close()`，确保连接收尾；`onComplete` 仍会用已积累的部分文本入库（>0 长度才入），便于"半成品消息"能在 UI 看到。
* 幂等键：客户端可传 `requestId` + `userMessageId`，server 用 client 传入的 UUID 直接落库，重试不会复制行。

### 8.5 解析失败（PDF 结构异常等）

* `files.status='failed'` + 错误日志。
* 前端在文件列表里展示 failed 态，提示重新上传 / 换格式。
* 解析层异常**不影响**其他文件的检索（按 file_id 隔离）。

### 8.6 Rerank 失败

* 网络/4xx/无 results → 打 `console.error` + 返回原召回顺序。
* 用户**无感知**，最多体验到精度略降。这是有意为之：rerank 是增强不是必经。

---

## 9. 安全与合规（当前底线）

* **认证与多租户**：session cookie 认证（opaque token 存 `sessions` 表，见 ADR 006）；每个 KB 归属一个 workspace，所有 KB 相关 API 经 `lib/authz/access.ts` 守卫（`knowledge_bases ⨝ workspace_members` join），跨租户返回 404、匿名 401（见 ADR 007）。协作走邀请码（`workspace_invites`，token 唯一、可过期、可撤销，见 ADR 008）。
* **Prompt 注入防护**：system 指令固定在 `buildPrompt`，不接受用户改写；目前没有 tool calling，所以工具白名单也尚未需要。
* **数据隔离**：`searchChunks` 强制按 `knowledgeBaseId` JOIN `files` 过滤，跨 KB 不会串。`POST /api/chat/stream` 也校验 conversation 属于传入的 KB。
* **敏感信息**：日志里只打 `requestId` + 错误 message，**不打**用户原文或 chunk 内容。原始文件 blob 走 Supabase Storage，依赖其 bucket 权限设置。
* **环境变量**：`.env*` 在 `.gitignore` 里；任何密钥泄露需走 rotate 流程。

---

## 10. 发布、回归与变更管理

### 配置化参数（已可调）

* `RERANK_ENABLED`、`OPENROUTER_RERANK_MODEL`
* `OPENROUTER_CHAT_MODEL`（兜底；前端 picker 优先）
* `OPENROUTER_EMBEDDING_MODEL`、`OPENROUTER_EMBEDDING_DIMENSIONS`（默认 `text-embedding-3-small` / 1536）
* 数据库连接（`DATABASE_URL`）

### 待硬编码改为可调（TODO）

* `topK=20` / `maxDistance=0.6` / rerank `topN=8` / final 5 —— 现在散在 `route.ts`，应抽到一个 `lib/rag/config.ts`。
* `chunkSize` / `overlap` —— 在 `lib/rag/chunks.ts` 里。
* `MAX_HISTORY_MESSAGES = 8`。

### 回归门禁

* 改检索 / prompt / 参数前后，跑 `/eval` 比较：
  * `retrievalHitRate` 不可显著下降
  * `citationHitRate` 不可显著下降
  * `avgLatencyMs` 不可显著上升
* with-rerank vs without-rerank 的对比图必须留作改动证据。

---

## 11. 当前实现状态 vs 后续路线

### ✅ 已实现

* 五个固定页面 + 完整 API CRUD
* session 认证 + workspace 多租户隔离（app 层守卫）+ 邀请制协作（成员/角色/邀请码）
* 多 KB 隔离 + 会话 + 历史消息持久化
* 上传 → 解析 → 分块 → 向量化 → HNSW 检索 → Cohere rerank → OpenRouter 流式生成
* 检索 metadata 过滤（fileIds / fileTypes / titleQuery，chat/search/eval 通用）
* 引用面板、SSE progress、abort、regenerate、会话标题自动生成
* `/eval` curated 数据集双跑对比（with/without rerank）+ LLM judge（faithfulness / answer relevance）+ 历史回看
* i18n（en/zh 双语，强约束）

### 🟡 已知缺口

* 解析-索引同步执行，没队列没重试
* `citation_invalid` 服务端事后校验未做
* token 用量 / 成本指标未采集
* hybrid 在当前数据集上没有质量收益，仍作为默认关闭的实验能力

### 🔭 后续可做（按价值排序）

1. ~~引入 BM25 混合检索，与纯向量 + rerank 做 A/B~~ —— 已落地：pg_trgm 关键词腿 +
   RRF 融合（`lib/rag/fusion.ts`），A/B 显示当前数据集上无收益，故默认关闭
   （`HYBRID_SEARCH_ENABLED`）；见 ADR-010 与 `docs/evals/hybrid-ab-2026-07-10.md`。
   可用 `pnpm eval:hybrid-ab -- --knowledge-base-id=<uuid> --dataset-id=<uuid>` 在关键词重的数据集上重测
2. 解析+向量化抽到 worker / 队列
3. 服务端引用校验 + 标注 `citation_invalid`
4. 句级对齐 / 高亮定位（提升引用精度）
5. token & cost 上报
