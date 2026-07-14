import assert from 'node:assert/strict';
import { mock, test, type Mock } from 'node:test';

// resolveChatProvider() reads this lazily, per call — the fetch below is mocked,
// so no test ever reaches the network.
process.env.OPENROUTER_API_KEY = 'test-key';

import { streamLlmAnswer } from './chat';
import { classifyChatError } from './errors';

type Sent = { event: string; data: Record<string, unknown> };

function collector() {
  const sent: Sent[] = [];
  return {
    sent,
    send: (event: string, data: unknown) => {
      sent.push({ event, data: data as Record<string, unknown> });
    },
  };
}

const encoder = new TextEncoder();

/**
 * A fetch stand-in that behaves like undici: the response body errors with the
 * abort reason when the request signal is aborted. Without that linkage a stall
 * test would prove nothing, because the reader would simply never settle.
 */
function fakeFetch(
  onStart: (controller: ReadableStreamDefaultController<Uint8Array>) => void,
  init: { status?: number; body?: unknown } = {},
): Mock<typeof fetch> {
  const impl = (async (_url: string | URL | Request, opts?: RequestInit) => {
    const signal = opts?.signal ?? undefined;

    if (init.status && init.status >= 400) {
      return new Response(JSON.stringify(init.body ?? {}), { status: init.status });
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        onStart(controller);
      },
    });

    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;

  return mock.method(globalThis, 'fetch', impl) as unknown as Mock<typeof fetch>;
}

function sseData(content: string): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

test.afterEach(() => {
  mock.restoreAll();
});

test('a stream that responds and then never produces output times out', async () => {
  // Headers arrive, body never yields. This is the case the client's idle
  // watchdog cannot catch, because the route keeps sending SSE keepalives.
  fakeFetch(() => {
    /* never enqueue, never close */
  });

  const c = collector();
  const persisted: string[] = [];

  await assert.rejects(
    () =>
      streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-1', {
        timeouts: { connectMs: 5_000, streamIdleMs: 60 },
        onComplete: (text) => {
          persisted.push(text);
        },
      }),
    (err: unknown) => {
      assert.equal(classifyChatError(err), 'timeout');
      return true;
    },
  );

  // A stalled turn is still finalized: nothing streamed, so nothing is saved,
  // and `done` must not be emitted.
  assert.deepEqual(persisted, ['']);
  assert.equal(c.sent.some((s) => s.event === 'done'), false);
});

test('upstream heartbeat comments do NOT reset the idle watchdog', async () => {
  // OpenRouter emits ": OPENROUTER PROCESSING" while a request is queued. A
  // byte-level idle timer would be kicked by these forever and never fire —
  // which is exactly how the browser-side watchdog fails. The watchdog must
  // measure model output, not traffic.
  fakeFetch((controller) => {
    const beat = setInterval(() => {
      try {
        controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));
      } catch {
        clearInterval(beat);
      }
    }, 10);
  });

  const c = collector();

  await assert.rejects(
    () =>
      streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-2', {
        timeouts: { connectMs: 5_000, streamIdleMs: 80 },
      }),
    (err: unknown) => {
      assert.equal(classifyChatError(err), 'timeout');
      return true;
    },
  );

  assert.equal(c.sent.some((s) => s.event === 'token'), false);
});

test('a stall mid-answer keeps the partial text and reports a timeout', async () => {
  fakeFetch((controller) => {
    controller.enqueue(sseData('The lead '));
    controller.enqueue(sseData('researcher is'));
    // ...and then the provider goes silent.
  });

  const c = collector();
  const persisted: string[] = [];

  await assert.rejects(
    () =>
      streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-3', {
        timeouts: { connectMs: 5_000, streamIdleMs: 60 },
        onComplete: (text) => {
          persisted.push(text);
        },
      }),
    (err: unknown) => {
      assert.equal(classifyChatError(err), 'timeout');
      return true;
    },
  );

  assert.deepEqual(
    c.sent.filter((s) => s.event === 'token').map((s) => s.data.delta),
    ['The lead ', 'researcher is'],
  );
  assert.deepEqual(persisted, ['The lead researcher is']);
});

test('output keeps the watchdog alive across a slow stream', async () => {
  // Deltas spaced wider apart than a single idle window, but each one re-arms it.
  fakeFetch((controller) => {
    let i = 0;
    const words = ['slow ', 'but ', 'alive'];
    const tick = setInterval(() => {
      if (i < words.length) {
        controller.enqueue(sseData(words[i++]));
        return;
      }
      clearInterval(tick);
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }, 40);
  });

  const c = collector();

  await streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-4', {
    timeouts: { connectMs: 5_000, streamIdleMs: 100 },
  });

  assert.equal(
    c.sent
      .filter((s) => s.event === 'token')
      .map((s) => s.data.delta)
      .join(''),
    'slow but alive',
  );
  assert.equal(c.sent.at(-1)?.event, 'done');
});

test('a rate-limited upstream is reported as rate_limited, not a raw 429', async () => {
  fakeFetch(() => {}, { status: 429, body: { error: { message: 'rate limit exceeded' } } });

  const c = collector();
  await streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-5');

  const error = c.sent.find((s) => s.event === 'error');
  assert.ok(error);
  assert.equal(error.data.code, 'rate_limited');
  assert.equal(error.data.status, 429);
  // The upstream text stays on the payload for the server log; the code is what
  // the client turns into a sentence.
  assert.equal(error.data.message, 'rate limit exceeded');
  assert.equal(c.sent.some((s) => s.event === 'done'), false);
});

test('an upstream outage is reported as llm_unavailable', async () => {
  fakeFetch(() => {}, { status: 503, body: { error: { message: 'no instances available' } } });

  const c = collector();
  await streamLlmAnswer(c.send as never, 'prompt', new AbortController().signal, 'req-6');

  assert.equal(c.sent.find((s) => s.event === 'error')?.data.code, 'llm_unavailable');
});
