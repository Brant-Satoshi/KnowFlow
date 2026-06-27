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
  /** OpenRouter model id from `lib/llm/catalog.ts`. NULL means use default. */
  model: string | null;
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
  chunkCount?: number;
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
  // Context-enriched text (document/section titles + text) used only for
  // embedding and reranking. Display, prompt and citations still use `text`.
  embeddingText?: string;
  documentTitle?: string | null;
  sectionTitle?: string | null;
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
/**
 * A single evaluation case.
 *
 * Relevance grading (see lib/eval/relevance.ts) uses these fields:
 * - grade 3: chunk text contains any string in `targetChunkSubstrings` (strongest signal,
 *            wins regardless of whether the chunk's file is in `targetFileNames`)
 * - grade 2: chunk file is in `targetFileNames` AND chunk text contains any keyword in
 *            `expectedKeywords` (`expectedKeywords` is intentionally reused by
 *            citation checks)
 * - grade 1: chunk file is in `targetFileNames` but no keyword overlap
 * - grade 0: neither
 *
 * `expectedAnswer` is unused in PR 1; reserved for reference-based judging in a later PR.
 */

export type EvalCaseCategory =
  | 'single_fact'
  | 'numeric_fact'
  | 'list_extraction'
  | 'synthesis'
  | 'disambiguation'
  | 'out_of_scope';

export type EvalCaseDifficulty = 'easy' | 'medium' | 'hard';

export interface EvalCase {
  id: string;
  question: string;
  expectedKeywords: string[];
  category: EvalCaseCategory;
  difficulty: EvalCaseDifficulty;
  answerable: boolean;
  targetFileNames?: string[];
  targetChunkSubstrings?: string[];
  expectedAnswer?: string;
  notes?: string;
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
  /** Reference answer from the dataset. Curated mode only. */
  expectedAnswer?: string;
  /** Per-chunk relevance grade (0–3) aligned to `retrievedChunks`. Curated mode only. */
  gradedHits?: number[];
  /** LLM-judge faithfulness 0–1 (answer grounded in chunks). null when not judged. */
  faithfulness?: number | null;
  /** LLM-judge answer relevance 0–1 (answer addresses the question). null when not judged. */
  answerRelevance?: number | null;
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
  // Curated-mode fields:
  recallAtK?: Record<number, number>;
  precisionAtK?: Record<number, number>;
  ndcgAtK?: Record<number, number>;
  mrr?: number;
  /** Mean LLM-judge faithfulness over judged cases; null when none judged. */
  avgFaithfulness?: number | null;
  /** Mean LLM-judge answer relevance over judged cases; null when none judged. */
  avgAnswerRelevance?: number | null;
  mode?: 'curated';
  datasetHash?: string;
}

export interface EvalRunComparison {
  knowledgeBaseId: string;
  withRerank: EvalRunResult;
  withoutRerank: EvalRunResult;
}

/**
 * One run as returned by `GET /api/eval/runs` (newest first). Mirrors the
 * persisted `eval_runs` row (top-level metrics only, no per-case items).
 */
export interface EvalRunSummary {
  id: string;
  knowledgeBaseId: string;
  datasetId: string | null;
  datasetName: string | null;
  datasetHash: string | null;
  mode: string;
  useRerank: boolean;
  totalCases: number;
  passedCases: number;
  retrievalHitRate: number;
  citationHitRate: number;
  avgLatencyMs: number;
  recallAtK: Record<string, number> | null;
  precisionAtK: Record<string, number> | null;
  ndcgAtK: Record<string, number> | null;
  mrr: number | null;
  avgFaithfulness: number | null;
  avgAnswerRelevance: number | null;
  createdAt: ISODateString;
}

/** One persisted case (an `eval_run_items` row) within a run detail. */
export interface EvalRunItemRecord {
  id: string;
  runId: string;
  idx: number;
  caseKey: string;
  question: string;
  passed: boolean;
  failureReasons: string[];
  retrievalHit: boolean;
  citationHit: boolean;
  latencyMs: number;
  retrievedChunks: EvalChunkHit[];
  topKHits: EvalTopKHit[];
  answer: string;
  expectedAnswer: string | null;
  gradedHits: number[] | null;
  faithfulness: number | null;
  answerRelevance: number | null;
}

/** A run plus its per-case items, as returned by `GET /api/eval/runs/[id]`. */
export interface EvalRunDetail extends EvalRunSummary {
  items: EvalRunItemRecord[];
}
