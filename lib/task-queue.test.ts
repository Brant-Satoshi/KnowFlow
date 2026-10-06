import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTaskQueue } from './task-queue';

// Each task waits on its own gate, so the test decides when it finishes.
function gates() {
  const resolvers = new Map<string, () => void>();
  return {
    wait(id: string) {
      return new Promise<void>((resolve) => resolvers.set(id, resolve));
    },
    open(...ids: string[]) {
      for (const id of ids) {
        const resolve = resolvers.get(id);
        assert.ok(resolve, `task ${id} has not started`);
        resolve();
      }
    },
  };
}

/** Let every pending promise callback (task starts, settles) run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('runs at most `concurrency` tasks at once, starting them in order', async () => {
  const gate = gates();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const queue = createTaskQueue<string>({
    concurrency: 2,
    run: async (id) => {
      started.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await gate.wait(id);
      active -= 1;
    },
  });

  queue.push('a', 'b', 'c', 'd', 'e');
  await flush();
  assert.deepEqual(started, ['a', 'b']);
  assert.equal(queue.running, 2);
  assert.equal(queue.pending, 3);

  // Whichever task finishes first, its slot goes to the next one in line.
  gate.open('b');
  await flush();
  assert.deepEqual(started, ['a', 'b', 'c']);

  gate.open('a', 'c');
  await flush();
  assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e']);

  gate.open('d', 'e');
  await flush();
  assert.equal(peak, 2);
  assert.equal(queue.running, 0);
  assert.equal(queue.pending, 0);
});

test('picks up tasks pushed mid-run and reports idle once per drain', async () => {
  const gate = gates();
  let idle = 0;
  const queue = createTaskQueue<string>({
    concurrency: 1,
    run: (id) => gate.wait(id),
    onIdle: () => {
      idle += 1;
    },
  });

  queue.push('a');
  await flush();
  queue.push('b'); // arrives while 'a' is still running
  gate.open('a');
  await flush();
  assert.equal(idle, 0, "'b' is still running");

  gate.open('b');
  await flush();
  assert.equal(idle, 1);

  // A batch started after the queue drained gets its own idle signal.
  queue.push('c');
  await flush();
  gate.open('c');
  await flush();
  assert.equal(idle, 2);
});

test('remove drops a waiting task but cannot cancel one that has started', async () => {
  const gate = gates();
  const started: string[] = [];
  const queue = createTaskQueue<string>({
    concurrency: 1,
    run: async (id) => {
      started.push(id);
      await gate.wait(id);
    },
  });

  queue.push('a', 'b', 'c');
  await flush();
  assert.equal(queue.remove((id) => id === 'a'), false, "'a' already started");
  assert.equal(queue.remove((id) => id === 'b'), true);
  assert.equal(queue.remove((id) => id === 'b'), false, "'b' is already gone");
  assert.equal(queue.pending, 1);

  gate.open('a');
  await flush();
  gate.open('c');
  await flush();
  assert.deepEqual(started, ['a', 'c']);
});

test('a failing task is logged and does not stall the queue', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const done: string[] = [];
  let idle = 0;
  const queue = createTaskQueue<string>({
    concurrency: 1,
    run: (id) => {
      if (id === 'throws') throw new Error('synchronous failure');
      if (id === 'rejects') return Promise.reject(new Error('async failure'));
      done.push(id);
      return Promise.resolve();
    },
    onIdle: () => {
      idle += 1;
    },
  });

  queue.push('throws', 'rejects', 'ok');
  await flush();
  assert.deepEqual(done, ['ok']);
  assert.equal(logged.mock.callCount(), 2);
  assert.equal(queue.running, 0);
  assert.equal(idle, 1);
});

test('concurrency must be a positive integer', () => {
  const run = () => Promise.resolve();
  assert.throws(() => createTaskQueue({ concurrency: 0, run }), RangeError);
  assert.throws(() => createTaskQueue({ concurrency: 1.5, run }), RangeError);
});
