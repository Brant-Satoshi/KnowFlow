import { Chunk } from "../types";
import { resolveEmbeddingProvider, type EmbeddingProviderConfig } from "../models";

const EXPECTED_EMBEDDING_DIMENSIONS = 1536;

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

type EmbeddingOptions = {
  signal?: AbortSignal;
};

function assertValidEmbedding(vector: number[] | undefined, index: number): number[] {
  if (!vector) {
    throw new Error(`embedding response missing vector at index ${index}`);
  }

  if (vector.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSIONS}, got ${vector.length}`
    );
  }

  return vector;
}

function getResponseMessage(payload: unknown, status: number): string {
  if (!payload || typeof payload !== 'object') {
    return `invalid JSON response (${status})`;
  }

  const response = payload as { error?: { message?: string } };

  return response.error?.message ?? `invalid response (${status})`;
}

function buildRequestBody(input: string[], cfg: EmbeddingProviderConfig) {
  return {
    model: cfg.model,
    input,
    ...(cfg.dimensions ? { dimensions: cfg.dimensions } : {}),
  };
}

async function createEmbeddings(
  input: string[],
  options?: EmbeddingOptions
): Promise<number[][]> {
  const cfg = resolveEmbeddingProvider();

  // env-supplied dimensions must match chunks.embedding vector(1536) schema.
  if (cfg.dimensions !== undefined && cfg.dimensions !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `embedding dimensions=${cfg.dimensions} does not match chunks.embedding vector(${EXPECTED_EMBEDDING_DIMENSIONS})`
    );
  }

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(buildRequestBody(input, cfg)),
    signal: options?.signal,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new Error(`embedding failed: ${getResponseMessage(payload, res.status)}`);
  }

  const response = payload as OpenAIEmbeddingResponse;
  if (!response.data || response.data.length !== input.length) {
    throw new Error(`embedding failed: ${getResponseMessage(response, res.status)}`);
  }

  return response.data.map((item, index) => assertValidEmbedding(item.embedding, index));
}

export async function embedText(
  text: string,
  options?: EmbeddingOptions
): Promise<number[]> {
  const [embedding] = await createEmbeddings([text], options);
  return embedding;
}

export async function embedChunk(
  chunks: Chunk[],
  options?: EmbeddingOptions
): Promise<Chunk[]> {
  const texts = chunks.map((chunk) => chunk.text);
  const vectors = await createEmbeddings(texts, options);

  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors[i] || [],
  }));
}
