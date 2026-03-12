# RAG 文档问答系统 Architecture

## 1. 产品目标与边界

### 目标用户

* 需要对**内部资料/项目文档/规范**快速查找与问答的用户（研发/运营/客服/产品/管理者）。
* 典型任务：在一堆文档中定位依据、总结要点、生成可追溯的回答。

### 核心场景

1. **基于文档的问答**：用户选择文件/知识库，提出问题，得到"可引用"的回答。
2. **证据回溯**：回答中的每个结论能点开来源（文件/页码/片段）。
3. **批量评测与回归**：用题集评估检索/回答质量，保证迭代不退化。

### 明确不做（Day0~MVP 范围外）

* 不做模型训练/微调；优先做工程化约束与可靠性闭环。
* 不承诺"全知回答"；**缺证据时必须拒答/引导**。
* 不做复杂权限矩阵（先最小 RBAC/Workspace），不做跨企业多租户深度隔离（后续阶段再扩展）。

---

## 2. 端到端架构图（文字版）

```
[Browser/Client]
  ├─ /knowledge-bases/:id/chat      (RAG Chat UI, Streaming, Abort/Retry, Citations)
  ├─ /files     (Upload, List, Parse/Index status)
  └─ /eval      (Dataset runner, metrics dashboard)

        │ HTTPS (JSON) + SSE (stream)
        ▼

[App Server / API Layer]
  ├─ POST /api/files/upload
  ├─ GET  /api/files
  ├─ GET  /api/files/:id
  ├─ GET  /api/files/:id/chunks
  ├─ POST /api/files/:id/parse
  ├─ POST /api/rag/search
  ├─ POST /api/chat/stream   (SSE tokens + done(citations))
  └─ (All responses include requestId)

        │
        ├──────────────┬───────────────────┬─────────────────┐
        ▼              ▼                   ▼                 ▼

[Object Storage]   [Metadata DB]       [Vector Index]     [LLM Provider]
(files)            (conversations,     (embeddings,       (chat/completions,
                   docs, chunks,        ANN search)        embeddings)
                   requests, metrics)

        ▲              ▲                   ▲                 ▲
        └──────────────┴──────── Telemetry/Observability ───┘
                 (logs, latency breakdown, token usage, cache hit)
```

---

## 3. 核心模块结构

### 3.1 API Routes

```
app/api/
├── files/
│   ├── route.ts           # GET /api/files - 文件列表
│   ├── upload/
│   │   └── route.ts       # POST /api/files/upload - 上传文件
│   └── [id]/
│       ├── route.ts       # GET/DELETE /api/files/:id
│       ├── chunks/
│       │   └── route.ts   # GET /api/files/:id/chunks
│       └── parse/
│           └── route.ts   # POST /api/files/:id/parse - 解析文件
├── rag/
│   └── search/
│       └── route.ts       # POST /api/rag/search - 向量检索
└── chat/
    └── stream/
        └── route.ts       # POST /api/chat/stream - SSE 流式对话
```

### 3.2 Core Libraries

```
lib/
├── api/
│   └── response.ts        # 统一 API 响应格式 { requestId, ok, data?, error? }
├── db/
│   ├── pg.ts             # PostgreSQL 连接池 (pg + pgvector)
│   ├── files.ts          # 文件元数据 CRUD
│   ├── chunks.ts         # Chunk CRUD + 向量操作
│   └── storage.ts        # 通用存储抽象
├── llm/
│   └── chat.ts           # LLM 调用 (OpenAI/Anthropic)
├── rag/
│   ├── parse.ts          # 文档解析 (PDF/MD/DOCX)
│   ├── chunks.ts         # 文本分块 (chunkSize + overlap)
│   ├── embeddings.ts     # 向量生成
│   └── search.ts         # 向量检索
├── telemetry/
│   └── requestId.ts     # 请求追踪
├── types.ts              # 共享类型定义
├── utils.ts              # 工具函数
└── validation.ts        # 输入验证
```

---

## 4. 核心数据模型（逻辑层）

### 4.1 共享类型 (lib/types.ts)

```typescript
// Chat
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: ISODateString;
  status: 'sending' | 'streaming' | 'done' | 'error';
}

interface Conversation {
  id: string;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Files / RAG
type FileDocStatus = 'uploaded' | 'parsing' | 'indexed' | 'failed';

interface FileDoc {
  id: string;
  name: string;
  type: string;      // MIME type
  size: number;      // bytes
  status: FileDocStatus;
  createdAt: ISODateString;
}

interface ChunkMeta {
  page?: number;
  start?: number;
  end?: number;
}

interface Chunk {
  id: string;
  fileId: string;
  idx: number;
  text: string;
  meta: ChunkMeta;
  embedding?: number[];
}

interface Citation {
  fileId: string;
  chunkId: string;
  page?: number;
  quote: string;
}
```

---

## 5. 关键链路设计

### 5.1 上传 → 解析 → 分块

1. 上传文件到对象存储（或本地），写入 FileDoc (status=uploaded)
2. 解析文本（PDF/MD/TXT）
3. 分块：chunkSize + overlap
4. 写入 chunks 与 meta（为引用回溯做准备）

**设计要点**

* 分块必须稳定可复现（同文件同策略生成一致 chunk ids 或可映射）
* meta 设计优先"可定位"，否则引用形同虚设

---

### 5.2 向量化与索引

1. 对 chunk 文本做 embedding
2. 写入向量索引（pgvector）
3. 索引完成后 FileDoc.status = indexed

**设计要点**

* 索引是异步任务（未来可接队列）；MVP 可先同步但要有超时与重试策略
* embedding 结果可缓存（按 chunk hash），避免重复成本

---

### 5.3 Query 检索 → 生成回答（RAG）

1. 规范化 query（可选：简化/改写/去噪）
2. 向量检索 topK chunks（可按 fileIds 过滤）
3. 构造上下文：把 chunks 组织成"证据包"
4. 调用 LLM：要求**基于证据回答**，并输出引用（chunkId/page）
5. SSE 流式返回 tokens，结束时返回 citations

**设计要点**

* 输出必须可解释：**答案 + 引用**是一体化产物
* 低置信度（分数低/证据不足）必须拒答而不是编造

---

## 6. 关键权衡（Tradeoffs）

### 6.1 SSE vs WebSocket

* **选择 SSE**：实现简单、兼容性好、对"单向流式输出"更合适
* 代价：双向交互弱一些（但中断可以通过客户端 abort + 服务端检测关闭连接）

### 6.2 引用粒度：句级 vs 段级

* **MVP 选择段级/Chunk 级引用**：实现成本低、稳定
* 代价：精确度略差；后续可加"句子对齐"或"高亮定位"

### 6.3 chunkSize/topK：召回 vs 成本 vs 幻觉

* chunk 太小：召回碎片化，回答上下文不足
* chunk 太大：token 成本高，噪声大
* topK 太低：漏召回；太高：成本飙升、答案更容易跑偏

> 策略：先固定一组默认（例如 chunk 中等大小 + topK=5~8），再用 Eval 驱动调参。

### 6.4 只靠向量检索 vs 混合检索

* **MVP 先向量**：快、实现简单
* 后续视需求引入 BM25/关键字混合检索与 rerank 提升精度

### 6.5 严格拒答 vs "尽量回答"

* **产品策略选择严格拒答**：缺证据就提示用户换关键词/补充资料
* 代价：用户觉得"没那么聪明"，但可信度与合规显著更高

---

## 7. 指标体系（Metrics & Observability）

### 7.1 体验指标（前端/端到端）

* **TTFT（Time to First Token）**：首 token 时间（P50/P95）
* **E2E Latency**：端到端耗时（拆分：检索/生成/渲染）
* **Stream Error Rate**：流式中断/异常占比
* **Abort Rate**：用户主动中断比例（可反映输出啰嗦/不相关）

### 7.2 RAG 质量指标（可回归）

* **Citation Hit Rate**：答案是否附带有效引用（chunk 可打开、meta 存在）
* **Groundedness Proxy**：答案是否主要基于证据包（可用规则/评测题集衡量）
* **Eval Pass Rate**：离线题集通过率（按任务分组总结/对比）

### 7.3 成本指标（业务关心）

* **Avg tokens / P95 tokens**：生成 token 与上下文 token
* **Cache Hit Rate**：search cache / answer cache 命中
* **Cost per conversation**：单会话成本（估算也可）

### 7.4 观测实现约定

* 所有 API 返回统一结构并带 `requestId`：
  ```typescript
  { requestId: string; ok: boolean; data?: any; error?: string }
  ```
* 日志按 `requestId` 串联：
  * `search_ms`, `llm_ms`, `stream_ms`, `tokens_in/out`, `cache_hit`, `error_code`

---

## 8. 失败策略（Failure Modes & Fallbacks）

### 8.1 检索失败（无相关 chunk）

**表现**：topK 结果分数低或为空
**策略**：

* 前端提示"未在资料中找到依据"，给出可行动建议：
  * 换关键词/缩小范围/选择更多文件/上传缺失文档
* 返回结构化错误码：`RAG_NO_EVIDENCE`

### 8.2 LLM 超时/限流/服务不可用

**策略**：

* 立即停止 stream，提示可重试
* 可配置 fallback：切换更便宜/更稳定模型（后续阶段）
* 错误码：`LLM_TIMEOUT`, `LLM_RATE_LIMIT`, `LLM_UNAVAILABLE`

### 8.3 引用对不上（"编造引用"风险）

**策略**：

* 生成阶段要求引用必须来自证据包中的 chunkId
* 服务端校验：引用 chunkId 必须在本次 evidence 中，否则丢弃并标记 `citation_invalid`
* 前端若无引用：显示"本回答未能给出可靠引用"，建议重试/换问法

### 8.4 流式中断（网络抖动/用户 abort）

**策略**：

* 客户端状态机：`streaming -> aborted` 或 `streaming -> error`
* 支持"从头重试"（MVP）
* 幂等键：`clientMessageId` 防止重试造成重复消息

### 8.5 解析失败（PDF 结构异常）

**策略**：

* FileDoc.status=failed，记录原因
* 前端提示：建议换格式/重新上传/拆分文件
* 可导出 debug 信息（仅开发/管理员）

---

## 9. 安全与合规（MVP 必须有的底线）

* **Prompt 注入防护（原则）**
  * system 指令固定不可被用户覆盖
  * 工具调用白名单（后续加入工具时）
* **数据隔离（最小）**
  * fileIds 必须归属当前 workspace/user（后端校验）
* **敏感信息**
  * 不记录原文全文到日志；日志只记录 hash/统计
  * 如需持久化对话内容，明确用户可见与可删除策略（后续阶段）

---

## 10. 发布、回归与变更管理

### 配置化参数（必须可调）

* chunkSize / overlap / topK
* 模型版本、温度、max_tokens
* 是否启用 query 改写、是否启用 rerank
* 缓存 TTL

### 回归门禁

* 每次改动检索/Prompt/参数，必须跑 `/eval` 题集并对比指标：
  * citation hit rate 不能显著下降
  * TTFT / E2E P95 不可显著变差
  * 成本指标（tokens）不可无上限增长

### 灰度与回滚（后续可实现）

* Prompt 与参数版本化（配置中心/文件版本）
* 线上 A/B：对比有用率与引用命中率
* 一键回滚到上一版本参数/prompt

---

## 11. MVP 验收（对齐工程交付）

* `/knowledge-bases/:id/chat` 支持 SSE 流式 + 中断/重试（幂等）
* `/files` 支持上传、解析、索引状态可见
* `/eval` 支持题集跑分与指标汇总
* 每次请求都有 `requestId`，可追踪耗时拆分与 token 统计
* 回答默认附带引用；无证据时拒答并给出建议
