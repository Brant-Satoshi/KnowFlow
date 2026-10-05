/**
 * Deadlines for every OpenRouter call. Without them a hung provider hangs the
 * request forever: the client's idle watchdog cannot save us, because the chat
 * route's own 15s SSE keepalive keeps the browser's connection looking alive
 * even when the upstream has gone silent (see streamLlmAnswer).
 */
export const LLM_TIMEOUTS = {
  /** Chat stream: response headers must arrive. Cleared once they do. */
  connectMs: 60_000,
  /** Chat stream: upstream must keep producing model output, not just heartbeats. */
  streamIdleMs: 60_000,
  /** Whole call, embeddings (recall + indexing). */
  embeddingMs: 30_000,
  /** Whole call, rerank. Overrunning it degrades to recall order, not an error. */
  rerankMs: 15_000,
  /** Whole call, non-streaming completions (conversation titles, eval). */
  generateMs: 30_000,
} as const;

export interface Deadline {
  /** Pass to fetch: aborts when the caller aborts, or when the deadline expires. */
  readonly signal: AbortSignal;
  /** Cancel the pending deadline without abandoning the caller's abort linkage. */
  clear(): void;
  /** Re-arm the deadline for another `ms` — the idle-watchdog "kick". */
  reset(ms: number): void;
  /** Drop timers and listeners. Always call in a `finally`. */
  dispose(): void;
}

/**
 * Compose a caller's AbortSignal with a *cancellable, re-armable* deadline.
 *
 * `AbortSignal.timeout()` can do neither, which is why it isn't used here: a
 * streaming call has to drop its connect deadline the moment headers land (or it
 * would cut the answer off mid-sentence) and then re-arm a fresh one after every
 * token.
 *
 * A deadline abort carries a `TimeoutError`, which is how `classifyChatError`
 * tells "the provider went silent" apart from "the user pressed stop"
 * (`AbortError`).
 */
export function withDeadline(
  signal: AbortSignal | undefined,
  ms: number,
  reason: string,
): Deadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new DOMException(reason, 'TimeoutError')), delay);
  };

  const onCallerAbort = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  arm(ms);

  return {
    signal: controller.signal,
    clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    reset(next: number) {
      arm(next);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}
