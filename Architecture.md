# Architecture Documentation

## Overview

This is a Next.js 16 App Router application implementing a basic RAG (Retrieval-Augmented Generation) skeleton. The project provides chat functionality with knowledge base management, file upload, parsing, and text chunking capabilities.

## Project Structure

```
ai-rag-app/
├── app/                          # Next.js App Router
│   ├── (chat)/                  # Chat route group
│   │   └── chat/page.tsx        # Chat interface
│   ├── (eval)/                  # Evaluation route group
│   │   └── eval/page.tsx       # Evaluation page
│   ├── (rag)/                   # Files/RAG route group
│   │   └── files/page.tsx      # File management UI
│   ├── api/                     # API routes
│   │   ├── chat/               # Chat endpoints
│   │   └── files/              # File management endpoints
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Landing page
├── components/                   # React components
│   ├── ui/                     # Radix UI components
│   ├── chat-messages.tsx       # Message display
│   ├── chat-input.tsx          # Chat input
│   ├── knowledge-panel.tsx     # Knowledge base sidebar
│   └── empty-state.tsx         # Empty state UI
├── lib/                         # Library modules
│   ├── api/                    # API utilities
│   ├── db/                     # Database operations
│   ├── rag/                    # RAG utilities
│   ├── telemetry/              # Telemetry utilities
│   ├── types.ts                # TypeScript types
│   └── utils.ts                # Utility functions
├── data/                        # JSON data storage
│   ├── files.json              # File metadata
│   ├── chunks.json             # Text chunks
│   └── uploads/                # Uploaded files
└── public/                      # Static assets
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/chat` | Main chat interface |
| `/files` | File upload and management |
| `/eval` | Evaluation interface |

## API Endpoints

### Chat API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Non-streaming chat |
| POST | `/api/chat/stream` | Streaming chat with SSE |

### Files API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List all files |
| POST | `/api/files/upload` | Upload a new file |
| DELETE | `/api/files/[id]` | Delete a file |
| POST | `/api/files/[id]/parse` | Parse file into chunks |
| GET | `/api/files/[id]/chunks` | Get chunks for a file |

## Data Storage

The application uses **JSON file-based storage** in the `/data/` directory:

| File | Purpose |
|------|---------|
| `data/files.json` | File metadata (FileDoc[]) |
| `data/chunks.json` | Parsed text chunks (Chunk[]) |
| `data/uploads/` | Actual uploaded files |

## Types

### Core Types (`lib/types.ts`)

```typescript
// Common
type ISODateString = string;

// Chat
type MessageRole = 'user' | 'assistant' | 'system';
type MessageStatus = 'sending' | 'streaming' | 'done' | 'error';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: ISODateString;
  status: MessageStatus;
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
  type: string;
  size: number;
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
}

interface Citation {
  fileId: string;
  chunkId: string;
  page?: number;
  quote: string;
}
```

## API Response Format

All API endpoints return a standardized response:

```typescript
interface ApiResponse<T = unknown> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: string;
}
```

## SSE Streaming

The chat streaming API uses Server-Sent Events with event types:

- `meta`: Contains requestId
- `token`: Streaming text delta
- `done`: Stream completed
- `error`: Error occurred

## Dependencies

- **Framework**: Next.js 16.1.6
- **UI**: Radix UI, Tailwind CSS 4
- **AI**: Vercel AI SDK (@ai-sdk/react)
- **PDF**: pdf-parse
- **Icons**: lucide-react
- **Charts**: recharts
- **Validation**: zod
- **Notifications**: sonner
