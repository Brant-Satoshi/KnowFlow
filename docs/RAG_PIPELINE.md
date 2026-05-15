# RAG Pipeline

Every chat request follows a five-stage pipeline orchestrated in
[app/api/chat/stream/route.ts](../app/api/chat/stream/route.ts).
The response is a Server-Sent Events stream; progress events are emitted at
each stage so the UI can show live status.

---

## Stage 1 — Embed the query

```
embedText(message)  →  number[1536]
```

**File:** [lib/rag/embeddings.ts](../lib/rag/embeddings.ts) — `embedText`

The user's message is sent to an embedding model and converted to a 1536-dimensional
vector. The provider is selected at runtime:

| Env var present | Provider | Default model |
|---|---|---|
| `OPENAI_EMBEDDING_MODEL` | OpenAI-compatible | `text-embedding-3-small` |
| `MINIMAX_EMBEDDING_MODEL` | MiniMax | `embo-01` |
| neither | OpenAI-compatible | `text-embedding-3-small` |

MiniMax uses a `texts[]` request body; OpenAI uses `input[]`. Both paths
validate that the returned vector is exactly 1536 dimensions, matching the
`chunks.embedding vector(1536)` column.

**SSE event emitted:** `progress { stage: "searching" }`

---

## Stage 2 — Vector search (recall)

```
searchChunks(queryEmbedding, topK=20, maxDistance=0.4, knowledgeBaseId)
→  Chunk[]  (≤ 20 results)
```

**File:** [lib/db/chunks.ts](../lib/db/chunks.ts) — `searchChunks`

Runs a pgvector cosine-distance query against the `chunks` table:

```sql
SELECT ..., c.embedding <=> $1::vector AS distance
FROM chunks c
JOIN files f ON c.file_id = f.id::uuid
WHERE c.embedding IS NOT NULL
  AND c.embedding <=> $1::vector < 0.4        -- hard distance cutoff
  AND f.knowledge_base_id = $3::uuid
ORDER BY c.embedding <=> $1::vector
LIMIT 20
```

The `<=>` operator is accelerated by an HNSW index on `chunks.embedding`.
Distance is stored in `chunk.meta._distance` and later converted to a
similarity score (`1 - distance`) for display.

**SSE event emitted:** `progress { stage: "searched", recalledCount: N }`

---

## Stage 3 — Rerank

```
rerankChunks(message, recalledChunks, { topN: 8 })
→  Chunk[]  (reordered, ≤ 8 results)
```

**File:** [lib/rag/rerank.ts](../lib/rag/rerank.ts) — `rerankChunks`

Skipped automatically when:
- `RERANK_ENABLED=false`
- only 0 or 1 chunks were recalled (nothing to re-order)

Otherwise sends all recalled chunk texts plus the query to the OpenRouter
rerank endpoint (`cohere/rerank-v3.5`). The API returns results sorted by
`relevance_score`; the function reattaches scores to each chunk as
`meta._rerankScore` and appends any chunks the API omitted at the end
(defensive fallback).

**Why rerank?** Vector similarity captures semantic proximity but not
task-specific relevance. Cohere's cross-encoder reads query + document
together and produces a better relevance signal, typically boosting precision
for the final context window.

**Failure mode:** Any network or API error falls back silently to the recall
order so the request still completes.

**SSE event emitted:** `progress { stage: "reranking" }` then
`progress { stage: "reranked", finalCount: N, rerankSkipped: bool }`

---

## Stage 4 — Build prompt & stream answer

```
buildPrompt(message, finalChunks.slice(0, 5))  →  string
streamLlmAnswer(send, prompt, signal, requestId, { history })
```

**File:** [lib/llm/chat.ts](../lib/llm/chat.ts)

Only the top 5 chunks after reranking enter the prompt. They are numbered:

```
[1] <chunk text>
[2] <chunk text>
...
```

`buildPrompt` detects summary queries (`isSummaryQuery`) and switches to a
bullet-point summarisation prompt; all other queries get a strict
grounded-answer prompt that instructs the model to cite by bracket number and
say "I couldn't find relevant information" if context is insufficient.

`streamLlmAnswer` sends an OpenAI-compatible chat completions request with
`stream: true`. The LLM provider is resolved in priority order:

1. `CHAT_PROVIDER` env var (explicit)
2. MiniMax if `MINIMAX_API_KEY` is set (default model: `abab6.5-chat`)
3. OpenRouter if `OPENROUTER_API_KEY` is set

The response body is read line-by-line (`data: ...` SSE frames from the LLM).
Each text delta is forwarded to the browser as a `token` event with a 10 ms
artificial delay to smooth rendering. Up to 8 prior conversation turns are
prepended as chat history.

**SSE events emitted:** `meta { retrievedChunks }` → `progress { stage: "generating" }` → `token { delta }` × N → `done`

---

## Stage 5 — Persist & close

After the LLM stream ends, `onComplete` runs inside `streamLlmAnswer`:

```typescript
await appendMessage(conversationId, 'assistant', fullText, retrievedChunks, requestId);
await touchConversation(conversationId);
```

The full assistant response and the `retrievedChunks` citation metadata are
written to the database. `touchConversation` updates `updated_at` so the
conversation list stays sorted.

---

## SSE event sequence

```
progress { stage: "searching" }
progress { stage: "searched",  recalledCount: N }
progress { stage: "reranking" }          ← only if N > 1 and rerank enabled
progress { stage: "reranked",  finalCount: M, rerankSkipped: bool }
meta     { requestId, retrievedChunks }
progress { stage: "generating" }
token    { delta: "..." }                ← repeated
done     { requestId }
```

On any error: `error { requestId, message }` replaces the tail of the sequence.

---

## Data flow diagram

```
User message
     │
     ▼
[1] embedText()          → vector[1536]
     │
     ▼
[2] searchChunks()       → ≤20 Chunk[]   (pgvector cosine, HNSW)
     │
     ▼
[3] rerankChunks()       → ≤8 Chunk[]    (Cohere cross-encoder via OpenRouter)
     │
     ▼  slice(0, 5)
[4] buildPrompt()        → string
    streamLlmAnswer()    → SSE token stream (MiniMax / OpenRouter)
     │
     ▼
[5] appendMessage()      → persisted to DB
```

---

## Key tradeoffs & design decisions

| Decision | Rationale |
|---|---|
| Recall 20, rerank to 8, prompt with 5 | Broad recall increases coverage; reranker improves precision; small final window keeps prompt cost low and avoids context dilution |
| Hard distance cutoff 0.4 | Prevents semantically unrelated chunks from entering the pipeline even if they are the "closest" available |
| Rerank fallback to recall order | Reranker is a quality enhancement, not a hard dependency — requests complete even if OpenRouter is down |
| Cosine distance via pgvector HNSW | Approximate nearest-neighbour at scale; HNSW trades a small accuracy loss for sub-millisecond search on large vector sets |
| SSE `progress` events | Lets the UI surface which stage is running without polling; useful for debugging latency in each stage |
