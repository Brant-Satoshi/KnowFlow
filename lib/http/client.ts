import type { ApiResponse } from '@/lib/api/response';

/**
 * Thrown when an internal /api request fails — either the HTTP layer
 * (network error, non-2xx status) or the application envelope reports
 * `ok: false`. Existing call sites use `try/catch` and `.catch(...)` around
 * `fetch`, surfacing `error instanceof Error ? error.message : fallback`, so
 * this extends `Error` with `message` set to the server's `error` string.
 *
 * The full envelope (`status`, `data`, `requestId`) is preserved so sites that
 * branch on e.g. `json.data?.code` or `res.status === 404` can keep doing so.
 */
export class HttpError<T = unknown> extends Error {
  readonly status: number;
  readonly data?: T;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; data?: T; requestId?: string },
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = options.status;
    this.data = options.data;
    this.requestId = options.requestId;
  }
}

export type HttpBody = BodyInit | Record<string, unknown> | unknown[] | null | undefined;

export interface HttpRequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

const JSON_HEADER = { 'Content-Type': 'application/json' };

/**
 * `FormData`, `Blob`, `ArrayBuffer`, typed arrays, `URLSearchParams` and
 * `ReadableStream` are passed through untouched so the browser sets the correct
 * `Content-Type` (e.g. multipart boundary for FormData). Plain objects/arrays
 * are JSON-serialised with an explicit `application/json` header.
 */
function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  );
}

function buildInit(
  method: string,
  body: HttpBody,
  options: HttpRequestOptions | undefined,
): RequestInit {
  const init: RequestInit = { method, signal: options?.signal };
  const headers = new Headers(options?.headers);

  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      init.body = body;
    } else {
      init.body = JSON.stringify(body);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', JSON_HEADER['Content-Type']);
      }
    }
  }

  init.headers = headers;
  return init;
}

export class HttpClient {
  private readonly baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * JSON request against an internal /api route. Parses the
   * `{ requestId, ok, data, error }` envelope.
   *
   * - On success (HTTP ok && envelope `ok: true`): resolves with `data` (`T`).
   * - On failure (non-2xx OR envelope `ok: false` OR unparseable body):
   *   throws `HttpError` whose `.message` is the server `error` string (falling
   *   back to the HTTP status text). The error carries `status`, `data` and
   *   `requestId` for callers that need them.
   *
   * AbortError from the fetch is re-thrown unchanged so existing
   * `err.name === "AbortError"` guards keep working.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: HttpBody,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const response = await fetch(this.baseUrl + path, buildInit(method, body, options));

    let envelope: ApiResponse<T> | null = null;
    try {
      envelope = (await response.json()) as ApiResponse<T>;
    } catch {
      envelope = null;
    }

    if (!response.ok || !envelope || envelope.ok !== true) {
      const message =
        (envelope && typeof envelope.error === 'string' && envelope.error) ||
        response.statusText ||
        `HTTP ${response.status}`;
      throw new HttpError<T | undefined>(message, {
        status: response.status,
        data: envelope?.data,
        requestId: envelope?.requestId,
      });
    }

    return envelope.data as T;
  }

  get<T = unknown>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T = unknown>(path: string, body?: HttpBody, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T = unknown>(path: string, body?: HttpBody, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  put<T = unknown>(path: string, body?: HttpBody, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  /**
   * `DELETE` with no request body. The second argument is `options` (matching
   * `get`), so `delete(path, { signal })` aborts as expected. For the rare
   * DELETE that needs a body, use {@link deleteWithBody}.
   */
  delete<T = unknown>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /** `DELETE` carrying a JSON (or raw) body, e.g. a list of ids to remove. */
  deleteWithBody<T = unknown>(path: string, body?: HttpBody, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, body, options);
  }

  /**
   * Streaming request (e.g. SSE at /api/chat/stream). Returns the raw
   * `Response` so consumers read `response.body` as a `ReadableStream`
   * unchanged. Throws `HttpError` only on non-2xx, parsing the error envelope
   * the same way the JSON helpers do; the success body is never consumed here.
   */
  async stream(
    method: string,
    path: string,
    body?: HttpBody,
    options?: HttpRequestOptions,
  ): Promise<Response> {
    const response = await fetch(this.baseUrl + path, buildInit(method, body, options));

    if (!response.ok) {
      const errPayload = (await response.json().catch(() => null)) as ApiResponse | null;
      const message =
        (errPayload && typeof errPayload.error === 'string' && errPayload.error) ||
        response.statusText ||
        `HTTP ${response.status}`;
      throw new HttpError(message, {
        status: response.status,
        data: errPayload?.data,
        requestId: errPayload?.requestId,
      });
    }

    return response;
  }
}

/** Shared singleton for internal same-origin /api calls. */
export const httpClient = new HttpClient();
