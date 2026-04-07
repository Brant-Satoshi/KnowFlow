import { Chunk } from "../types";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') ??
  'https://openrouter.ai/api/v1';
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
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

function getApiKey(): string {
  const rawKey = process.env.OPEN_ROUTER_KEY;
  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return key;
}

function getEmbeddingUrl(): string {
  return new URL('embeddings', `${OPENAI_BASE_URL}/`).toString();
}

function getEmbeddingDimensions(): number | undefined {
  const rawDimensions = process.env.OPENAI_EMBEDDING_DIMENSIONS?.trim();
  if (!rawDimensions) {
    return OPENAI_EMBEDDING_MODEL.startsWith('text-embedding-3')
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

async function createEmbeddings(input: string[]): Promise<number[][]> {
  const dimensions = getEmbeddingDimensions();
  const res = await fetch(getEmbeddingUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input,
      ...(dimensions ? { dimensions } : {}),
    }),
  });

  const payload = (await res.json()) as OpenAIEmbeddingResponse;
  if (!res.ok || !payload.data || payload.data.length !== input.length) {
    const message =
      payload?.error?.message ??
      `invalid response (${res.status})`;
    throw new Error(`OpenAI embedding failed: ${message}`);
  }

  return payload.data.map((item, index) => assertValidEmbedding(item.embedding, index));
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
