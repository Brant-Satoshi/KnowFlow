import { Chunk } from "../types";

type OpenRouterRerankResponse = {
    id?: string;
    model?: string;
    results?: Array<{
        index: number;
        relevance_score?: number;
        document?: {
            text?: string;
        };
    }>;
    usage?: {
        search_units?: number;
        total_tokens?: number;
    };
    error?: {
        message?: string;
        type?: string;
        code?: string;
    };
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_RERANK_MODEL = 'cohere/rerank-v3.5';

function readEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value.replace(/^['"]|['"]$/g, '') : undefined;
}

function getOpenRouterApiKey(): string {
    const key = readEnv('OPENROUTER_API_KEY') ?? readEnv('OPEN_ROUTER_KEY');
    if (!key) {
        throw new Error('Missing OPENROUTER_API_KEY (or OPEN_ROUTER_KEY)');
    }
    return key;
}

function getOpenRouterBaseUrl(): string {
    return (readEnv('OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '');
}

function getRerankModel(): string {
    return readEnv('OPENROUTER_RERANK_MODEL') ?? DEFAULT_OPENROUTER_RERANK_MODEL;
}

function getErrorMessage(payload: unknown, status: number): string {
    if (!payload || typeof payload !== 'object') {
        return `invalid response (${status})`;
    }

    const response = payload as {
        error?: { message?: string };
    };

    return response.error?.message ?? `invalid response (${status})`;
}

function isRerankEnabled(): boolean {
    return (readEnv('RERANK_ENABLED') ?? 'true').toLowerCase() === 'true';
}

type RerankOptions = {
    signal?: AbortSignal;
    topN?: number;
};

export async function rerankChunks(
    query: string,
    chunks: Chunk[],
    options: RerankOptions = {}
): Promise<Chunk[]> {
    if (!isRerankEnabled() || chunks.length <= 1) {
        return chunks;
    }


    const queryText = query.trim();
    if (!queryText) {
        return chunks;
    }
    const rawTopN = options.topN ?? chunks.length;
    const topN = Number.isInteger(rawTopN)
        ? Math.max(1, Math.min(rawTopN, chunks.length))
        : chunks.length;
    const documents = chunks.map((chunk) => chunk.text);

    let res: Response;
    try {
        res = await fetch(`${getOpenRouterBaseUrl()}/rerank`, {
            method: 'POST',
            signal: options.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getOpenRouterApiKey()}`,
            },
            body: JSON.stringify({
                model: getRerankModel(),
                query: queryText,
                documents,
                top_n: topN,
            }),
        });
    } catch (error) {
        console.error('[rerank] request failed, fallback to recall order:', error);
        return chunks;
    }
    let payload: unknown = null;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }
    if (!res.ok) {
        console.error('[rerank] bad response, fallback to recall order:', getErrorMessage(payload, res.status));
        return chunks;
    }

    const data = payload as OpenRouterRerankResponse;
    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
        return chunks;
    }

    const used = new Set<number>();
    const reranked: Chunk[] = [];

    for (const item of data.results) {
        const idx = item.index;
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunks.length || used.has(idx)) {
            continue;
        }
        reranked.push(chunks[idx]);
        used.add(idx);
    }

    for (let i = 0; i < chunks.length; i++) {
        if (!used.has(i)) {
            reranked.push(chunks[i]);
        }
    }
    return reranked;
}