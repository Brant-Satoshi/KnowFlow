import { DEFAULT_CHAT_MODEL_ID } from './llm/catalog';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value.replace(/^['"]|['"]$/g, '') : undefined;
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function getOpenRouterApiKey(): string {
  const key = readEnv('OPENROUTER_API_KEY');
  if (!key) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  return key;
}

function getOpenRouterBaseUrl(): string {
  return (readEnv('OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '');
}

// ---------- Chat ----------

export interface ChatProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

export function resolveChatProvider(modelId?: string): ChatProviderConfig {
  return {
    url: new URL('chat/completions', `${getOpenRouterBaseUrl()}/`).toString(),
    apiKey: getOpenRouterApiKey(),
    model: modelId ?? readEnv('OPENROUTER_CHAT_MODEL') ?? DEFAULT_CHAT_MODEL_ID,
  };
}

// ---------- Embedding ----------

export interface EmbeddingProviderConfig {
  url: string;
  apiKey: string;
  model: string;
  /** Optional body hint to coerce output dimensions. */
  dimensions?: number;
}

const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'text-embedding-3-small';

function getEmbeddingDimensions(model: string): number | undefined {
  const raw = readEnv('OPENROUTER_EMBEDDING_DIMENSIONS');
  if (!raw) {
    return model.startsWith('text-embedding-3') ? 1536 : undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('OPENROUTER_EMBEDDING_DIMENSIONS must be a positive integer');
  }
  return n;
}

export function resolveEmbeddingProvider(): EmbeddingProviderConfig {
  const model = readEnv('OPENROUTER_EMBEDDING_MODEL') ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL;
  return {
    url: new URL('embeddings', `${getOpenRouterBaseUrl()}/`).toString(),
    apiKey: getOpenRouterApiKey(),
    model,
    dimensions: getEmbeddingDimensions(model),
  };
}

// ---------- Rerank ----------

export interface RerankProviderConfig {
  url: string;
  apiKey: string;
  model: string;
}

const DEFAULT_OPENROUTER_RERANK_MODEL = 'cohere/rerank-v3.5';

export function resolveRerankProvider(): RerankProviderConfig {
  return {
    url: new URL('rerank', `${getOpenRouterBaseUrl()}/`).toString(),
    apiKey: getOpenRouterApiKey(),
    model: readEnv('OPENROUTER_RERANK_MODEL') ?? DEFAULT_OPENROUTER_RERANK_MODEL,
  };
}

export function isRerankEnabled(): boolean {
  return (readEnv('RERANK_ENABLED') ?? 'true').toLowerCase() === 'true';
}

/**
 * Whether chat recall fuses the keyword (pg_trgm) leg with vector search (RRF).
 * Defaults OFF: the eval (ADR-003) found fusion neutral-to-negative on the
 * current dataset — it hurts raw recall ordering and rerank erases any gain —
 * so vector-only stays the production default. Set `HYBRID_SEARCH_ENABLED=true`
 * to opt in (or preview via `/api/rag/search` with `mode: "hybrid"`).
 */
export function isHybridSearchEnabled(): boolean {
  return (readEnv('HYBRID_SEARCH_ENABLED') ?? 'false').toLowerCase() === 'true';
}
