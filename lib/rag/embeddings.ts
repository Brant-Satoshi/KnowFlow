import { Chunk } from "../types";
import { resolveEmbeddingProvider, type EmbeddingProviderConfig } from "../models";
import { EmbeddingError } from "../llm/errors";
import { extractUpstreamMessage, openRouterFetch, readJsonSafe } from "../llm/openrouter";
import { LLM_TIMEOUTS, withDeadline } from "../llm/timeouts";

export { EmbeddingError };

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
    throw new EmbeddingError(`embedding response missing vector at index ${index}`);
  }

  if (vector.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `embedding dimension mismatch: expected ${EXPECTED_EMBEDDING_DIMENSIONS}, got ${vector.length}`
    );
  }

  return vector;
}

function getResponseMessage(payload: unknown, status: number): string {
  return extractUpstreamMessage(payload) ?? `invalid response (${status})`;
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
    throw new EmbeddingError(
      `embedding dimensions=${cfg.dimensions} does not match chunks.embedding vector(${EXPECTED_EMBEDDING_DIMENSIONS})`,
      'config'
    );
  }

  const deadline = withDeadline(
    options?.signal,
    LLM_TIMEOUTS.embeddingMs,
    `embedding request timed out after ${LLM_TIMEOUTS.embeddingMs}ms`
  );

  try {
    const res = await openRouterFetch(cfg, buildRequestBody(input, cfg), deadline.signal);
    const payload = await readJsonSafe(res);

    if (!res.ok) {
      throw new EmbeddingError(`embedding failed: ${getResponseMessage(payload, res.status)}`);
    }

    const response = payload as OpenAIEmbeddingResponse;
    if (!response.data || response.data.length !== input.length) {
      throw new EmbeddingError(`embedding failed: ${getResponseMessage(response, res.status)}`);
    }

    return response.data.map((item, index) => assertValidEmbedding(item.embedding, index));
  } finally {
    deadline.dispose();
  }
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
  const texts = chunks.map((chunk) => chunk.embeddingText ?? chunk.text);
  const vectors = await createEmbeddings(texts, options);

  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors[i],
  }));
}
