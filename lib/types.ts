// Common
export type ISODateString = string; // e.g. "2026-02-06T23:15:30.123Z"

// Chat
export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: ISODateString;
  status: MessageStatus;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ConversationSummary extends Conversation {
  knowledgeBaseId: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  retrievedChunks: RetrievedChunk[] | null;
  createdAt: ISODateString;
}

export interface ConversationWithMessages extends ConversationSummary {
  messages: StoredMessage[];
}

// Knowledge Base
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// Files / RAG
export type FileDocStatus = 'uploaded' | 'parsing' | 'indexed' | 'failed';
export type FileDocClientStatus = 'uploading';

export interface FileDoc {
  id: string;
  name: string;
  type: string; // MIME type, e.g. "application/pdf"
  size: number; // bytes
  status: FileDocStatus;
  createdAt: ISODateString;
  knowledgeBaseId?: string; // 关联的知识库 ID
}

export interface FileListItem extends FileDoc {
  clientStatus?: FileDocClientStatus;
}

export interface ChunkMeta {
  page?: number;
  start?: number;
  end?: number;
  // Derived at retrieval time, not persisted to DB.
  _distance?: number;
  _rerankScore?: number;
}

export interface Chunk {
  id: string;
  fileId: string;
  idx: number;
  text: string;
  meta: ChunkMeta;
  embedding?: number[];
  fileName?: string;
}

export type RetrievedChunkScoreType = 'rerank' | 'vector';

export interface RetrievedChunk {
  index: number;
  chunkId: string;
  fileId: string;
  fileName: string;
  page?: number;
  quote: string;
  score?: number;
  scoreType?: RetrievedChunkScoreType;
}

export interface Citation {
  fileId: string;
  chunkId: string;
  page?: number;
  quote: string;
}

// Eval
export interface EvalCase {
  id: string;
  question: string;
  expectedKeywords: string[];
  targetFileNames?: string[];
  targetChunkSubstrings?: string[];
}

export interface EvalChunkHit {
  chunkId: string;
  fileId: string;
  fileName: string;
  textPreview: string;
}

export interface EvalTopKHit {
  k: number;
  hit: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  question: string;
  passed: boolean;
  failureReasons: string[];
  retrievalHit: boolean;
  citationHit: boolean;
  latencyMs: number;
  retrievedChunks: EvalChunkHit[];
  topKHits: EvalTopKHit[];
  answer: string;
}

export interface EvalRunResult {
  runId: string;
  knowledgeBaseId: string;
  totalCases: number;
  passedCases: number;
  retrievalHitRate: number;
  citationHitRate: number;
  avgLatencyMs: number;
  cases: EvalCaseResult[];
}

export interface EvalRunComparison {
  knowledgeBaseId: string;
  withRerank: EvalRunResult;
  withoutRerank: EvalRunResult;
}
