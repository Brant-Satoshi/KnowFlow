import { Chunk } from "../types";

const EXPECTED_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.chat/v1';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MINIMAX_EMBEDDING_MODEL = 'embo-01';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_MINIMAX_EMBEDDING_TYPE = 'db';

type EmbeddingProvider = 'minimax' | 'openai-compatible';

type OpenAIEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type MiniMaxEmbeddingResponse = {
  vectors?: number[][];
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  error?: {
    message?: string;
  };
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value.replace(/^['"]|['"]$/g, '') : undefined;
}

function getProvider(): EmbeddingProvider {
  if (readEnv('OPENAI_EMBEDDING_MODEL')) {
    return 'openai-compatible';
  }

  return readEnv('MINIMAX_EMBEDDING_MODEL') ? 'minimax' : 'openai-compatible';
}

function getApiKey(provider: EmbeddingProvider): string {
  const rawKey =
    provider === 'minimax'
      ? readEnv('MINIMAX_API_KEY') ?? readEnv('OPENAI_API_KEY')
      : readEnv('OPENAI_API_KEY') ?? readEnv('OPEN_ROUTER_KEY') ?? readEnv('MINIMAX_API_KEY');

  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error(
      provider === 'minimax' ? 'Missing MINIMAX_API_KEY' : 'Missing OPENAI_API_KEY'
    );
  }

  return key;
}

function getEmbeddingBaseUrl(provider: EmbeddingProvider): string {
  const baseUrl =
    provider === 'minimax'
      ? readEnv('MINIMAX_BASE_URL') ?? DEFAULT_MINIMAX_BASE_URL
      : readEnv('OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL;

  return baseUrl.replace(/\/+$/, '');
}

function getEmbeddingUrl(provider: EmbeddingProvider): string {
  return new URL('embeddings', `${getEmbeddingBaseUrl(provider)}/`).toString();
}

function getEmbeddingModel(provider: EmbeddingProvider): string {
  return provider === 'minimax'
    ? readEnv('MINIMAX_EMBEDDING_MODEL') ?? DEFAULT_MINIMAX_EMBEDDING_MODEL
    : readEnv('OPENAI_EMBEDDING_MODEL') ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
}

function getEmbeddingType(): string {
  return readEnv('MINIMAX_EMBEDDING_TYPE') ?? DEFAULT_MINIMAX_EMBEDDING_TYPE;
}

function getEmbeddingDimensions(provider: EmbeddingProvider): number | undefined {
  if (provider === 'minimax') {
    return EXPECTED_EMBEDDING_DIMENSIONS;
  }

  const rawDimensions = process.env.OPENAI_EMBEDDING_DIMENSIONS?.trim();
  if (!rawDimensions) {
    return getEmbeddingModel(provider).startsWith('text-embedding-3')
      ? EXPECTED_EMBEDDING_DIMENSIONS
      : undefined;
  }

  const dimensions = Number.parseInt(rawDimensions, 10);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error('OPENAI_EMBEDDING_DIMENSIONS must be a positive integer');
  }

  if (dimensions !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `OPENAI_EMBEDDING_DIMENSIONS=${dimensions} does not match chunks.embedding vector(${EXPECTED_EMBEDDING_DIMENSIONS})`
    );
  }

  return dimensions;
}

function assertValidEmbedding(vector: number[] | undefined, index: number): number[] {
  if (!vector) {
    throw new Error(`OpenAI embedding response missing vector at index ${index}`);
  }

  if (vector.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `OpenAI embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSIONS}, got ${vector.length}`
    );
  }

  return vector;
}

function getResponseMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== 'object') {
    return `invalid JSON response (${status})`;
  }

  const response = payload as {
    error?: { message?: string };
    base_resp?: { status_msg?: string };
  };

  return (
    response.error?.message ??
    response.base_resp?.status_msg ??
    `invalid response (${status})`
  );
}

async function createEmbeddings(input: string[]): Promise<number[][]> {
  const provider = getProvider();
  const dimensions = getEmbeddingDimensions(provider);
  const res = await fetch(getEmbeddingUrl(provider), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey(provider)}`,
    },
    body: JSON.stringify({
      ...(provider === 'minimax'
        ? {
            model: getEmbeddingModel(provider),
            texts: input,
            type: getEmbeddingType(),
          }
        : {
            model: getEmbeddingModel(provider),
            input,
            ...(dimensions ? { dimensions } : {}),
          }),
    }),
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(`OpenAI embedding failed: ${getResponseMessage(payload, res.status)}`);
  }

  if (provider === 'minimax') {
    const response = payload as MiniMaxEmbeddingResponse;
    if (response.base_resp?.status_code && response.base_resp.status_code !== 0) {
      throw new Error(`OpenAI embedding failed: ${getResponseMessage(response, res.status)}`);
    }
    if (!response.vectors || response.vectors.length !== input.length) {
      throw new Error(`OpenAI embedding failed: ${getResponseMessage(response, res.status)}`);
    }

    return response.vectors.map((vector, index) => assertValidEmbedding(vector, index));
  }

  const response = payload as OpenAIEmbeddingResponse;
  if (!response.data || response.data.length !== input.length) {
    const message = getResponseMessage(response, res.status);
    throw new Error(`OpenAI embedding failed: ${message}`);
  }

  return response.data.map((item, index) => assertValidEmbedding(item.embedding, index));
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await createEmbeddings([text]);
  return embedding;
}

export async function embedChunk(chunks: Chunk[]): Promise<Chunk[]> {
  const texts = chunks.map((chunk) => chunk.text);
  const vectors = await createEmbeddings(texts);

  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors[i] || [],
  }));
}
