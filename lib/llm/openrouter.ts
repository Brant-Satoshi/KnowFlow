/**
 * Shared OpenRouter HTTP plumbing for embeddings, rerank, and chat calls.
 * Callers own success/error semantics (throw vs fallback vs stream); this
 * module only unifies the request shape and error-message extraction.
 */

export interface OpenRouterEndpoint {
  url: string;
  apiKey: string;
}

export function openRouterFetch(
  endpoint: OpenRouterEndpoint,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(endpoint.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

/** Parse a JSON response body; null on empty or invalid JSON. */
export async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// OpenRouter wraps upstream provider errors as:
//   { error: { message: "Provider returned error", metadata: { raw: "<JSON>" } } }
// The `raw` field contains the actual provider message (e.g. "Model not found"),
// which is far more useful than the generic wrapper. Fall back to the wrapper
// message, then a top-level message, then undefined.
export function extractUpstreamMessage(errorData: unknown): string | undefined {
  if (typeof errorData === 'string') return errorData.length > 0 ? errorData : undefined;
  if (typeof errorData !== 'object' || errorData === null) return undefined;

  const root = errorData as Record<string, unknown>;
  const err = root.error;

  if (typeof err === 'object' && err !== null) {
    const errObj = err as Record<string, unknown>;
    const metadata = errObj.metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      const raw = (metadata as Record<string, unknown>).raw;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
          const inner = parsed?.error?.message;
          if (typeof inner === 'string' && inner.length > 0) return inner;
        } catch { }
      }
    }
    if (typeof errObj.message === 'string' && errObj.message.length > 0) return errObj.message;
  }

  if (typeof root.message === 'string' && root.message.length > 0) return root.message;
  return undefined;
}
