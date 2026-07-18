/**
 * The error taxonomy shared by the chat pipeline and the UI.
 *
 * Codes travel on the SSE `error` event next to the raw upstream `message`: the
 * message is for the server log, the code is what the client turns into a
 * sentence a person can act on. Keep this module dependency-free — the browser
 * imports it.
 */

export type ChatErrorCode =
  | 'rate_limited'
  | 'llm_unavailable'
  | 'llm_auth'
  | 'timeout'
  | 'embedding_failed'
  | 'service_config'
  | 'llm_error';

const CHAT_ERROR_CODES: readonly string[] = [
  'rate_limited',
  'llm_unavailable',
  'llm_auth',
  'timeout',
  'embedding_failed',
  'service_config',
  'llm_error',
];

/** Guard for the code as it arrives off the wire — never trust it as a key. */
export function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === 'string' && CHAT_ERROR_CODES.includes(value);
}

/**
 * A failure of the embedding stage.
 *   - 'upstream': the provider rejected the call or returned something unusable
 *   - 'config':   the deployment is misconfigured (dimensions that can't fit the
 *                 schema) — retrying will not help, an operator has to act
 */
export class EmbeddingError extends Error {
  readonly kind: 'upstream' | 'config';

  constructor(message: string, kind: 'upstream' | 'config' = 'upstream') {
    super(message);
    this.name = 'EmbeddingError';
    this.kind = kind;
  }
}

export function classifyUpstreamStatus(status: number): ChatErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'llm_auth';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'llm_unavailable';
  return 'llm_error';
}

export function classifyChatError(e: unknown): ChatErrorCode {
  // Deadline aborts (lib/llm/timeouts.ts) carry TimeoutError; a user pressing
  // stop carries AbortError, and never reaches a user-visible message anyway.
  if (e instanceof Error && e.name === 'TimeoutError') return 'timeout';
  if (e instanceof EmbeddingError) {
    return e.kind === 'config' ? 'service_config' : 'embedding_failed';
  }
  return 'llm_error';
}
