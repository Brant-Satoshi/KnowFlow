import { Chunk } from "../types";
import { isRerankEnabled, resolveRerankProvider } from "../models";

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

function getErrorMessage(payload: unknown, status: number): string {
    if (!payload || typeof payload !== 'object') {
        return `invalid response (${status})`;
    }

    const response = payload as {
        error?: { message?: string };
    };

    return response.error?.message ?? `invalid response (${status})`;
}

type RerankOptions = {
    signal?: AbortSignal;
    topN?: number;
    force?: boolean;
};

export async function rerankChunks(
    query: string,
    chunks: Chunk[],
    options: RerankOptions = {}
): Promise<Chunk[]> {
    if ((!options.force && !isRerankEnabled()) || chunks.length <= 1) {
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

    const cfg = resolveRerankProvider();

    let res: Response;
    try {
        res = await fetch(cfg.url, {
            method: 'POST',
            signal: options.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: cfg.model,
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
        const original = chunks[idx];
        const rerankScore = typeof item.relevance_score === 'number' ? item.relevance_score : undefined;
        reranked.push({
            ...original,
            meta: { ...(original.meta ?? {}), _rerankScore: rerankScore },
        });
        used.add(idx);
    }

    for (let i = 0; i < chunks.length; i++) {
        if (!used.has(i)) {
            reranked.push(chunks[i]);
        }
    }
    return reranked;
}
