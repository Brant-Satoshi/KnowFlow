# Project Rules

## Project Overview
- Next.js App Router 项目，用于 RAG + LLM 聊天应用
- 使用 PostgreSQL + pgvector 进行向量存储

## Routes
- `/chat` - 聊天页面
- `/files` - 文件管理页面
- `/eval` - 评估页面

## Core Modules
- `lib/llm/` - LLM 调用（OpenAI/Anthropic）
- `lib/rag/` - RAG 流程（分块、嵌入、搜索）
- `lib/db/` - 数据库操作（PostgreSQL）
- `lib/telemetry/` - 遥测

## Shared Types (lib/types.ts)
- `Message`, `Conversation` - 聊天相关
- `FileDoc`, `Chunk`, `Citation` - 文件和 RAG 相关

## API Response Shape
所有 API 端点必须包含 requestId：
```typescript
{ requestId, ok, data?, error? }
```

## Constraints
- Do NOT add extra pages beyond /chat, /files, /eval
- Keep changes minimal and runnable
- Use standard API response shape

## Output format whenever asked to implement:
1) List changed files
2) Provide file-by-file code
3) Provide commands to run + checklist to verify
