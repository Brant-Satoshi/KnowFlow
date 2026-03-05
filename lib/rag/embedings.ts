import { Chunk } from "../types";

const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL?.replace(/\/+$/, '') ??
  process.env.OPENAI_BASE_URL?.replace(/\/+$/, '') ??
  'https://api.minimax.chat/v1';
const MINIMAX_EMBEDDING_MODEL =
  process.env.MINIMAX_EMBEDDING_MODEL ?? 'embo-01';
const MINIMAX_EMBEDDING_TYPE =
  process.env.MINIMAX_EMBEDDING_TYPE ?? 'db';

function getApiKey(): string {
  const rawKey = process.env.MINIMAX_API_KEY ?? process.env.OPENAI_API_KEY;
  const key = rawKey?.trim().replace(/^['"]|['"]$/g, '');
  if (!key) {
    throw new Error('Missing MINIMAX_API_KEY (or OPENAI_API_KEY)');
  }
  return key;
}

function getEmbeddingUrl(): string {
  const url = new URL('embeddings', `${MINIMAX_BASE_URL}/`);
  const groupId = process.env.MINIMAX_GROUP_ID ?? process.env.GROUP_ID;
  if (groupId) {
    url.searchParams.set('GroupId', groupId);
  }
  return url.toString();
}

type MiniMaxEmbeddingResponse = {
  vectors?: number[][] | null;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(getEmbeddingUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: MINIMAX_EMBEDDING_MODEL,
      texts: [text],
      type: MINIMAX_EMBEDDING_TYPE,
    }),
  });

  const payload = (await res.json()) as MiniMaxEmbeddingResponse;
  const vector = payload?.vectors?.[0];
  if (!res.ok || !vector) {
    const code = payload?.base_resp?.status_code ?? res.status;
    const msg = payload?.base_resp?.status_msg ?? 'invalid response';
    throw new Error(`MiniMax embedding failed (${code}): ${msg}`);
  }

  return vector;
}

export async function embedChunk(chunks: Chunk[]): Promise<Chunk[]> {
  const texts = chunks.map(c => c.text);
  const res = await fetch(getEmbeddingUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: MINIMAX_EMBEDDING_MODEL,
      texts,
      type: MINIMAX_EMBEDDING_TYPE,
    }),
  });

  const payload = (await res.json()) as MiniMaxEmbeddingResponse;
  const vectors = payload?.vectors;
  if (!res.ok || !vectors || vectors.length !== chunks.length) {
    const code = payload?.base_resp?.status_code ?? res.status;
    const msg = payload?.base_resp?.status_msg ?? 'invalid response';
    throw new Error(`MiniMax embedding failed (${code}): ${msg}`);
  }

  return chunks.map((chunk, i) => ({
    ...chunk,
    embedding: vectors?.[i] || [],
  }));
}