/**
 * A FIFO work queue that runs at most `concurrency` tasks at a time.
 *
 * Batch upload turns every selected file into one task (upload, then parse). The
 * cap keeps a 20-file drop from opening 20 long requests at once, which would
 * take the browser's per-origin connections away from the chat's SSE stream and
 * fire 20 embedding calls in the same instant.
 *
 * Plain TypeScript with no React, so the scheduling rules are tested on their
 * own (lib/task-queue.test.ts).
 */
export interface TaskQueue<T> {
  /** Append tasks and start as many as the concurrency cap allows. */
  push(...items: T[]): void;
  /**
   * Drop the first task that is still waiting for a slot and matches
   * `predicate`. A task that has started can't be removed. Returns whether a
   * task was dropped.
   */
  remove(predicate: (item: T) => boolean): boolean;
  /** Tasks waiting for a slot. */
  readonly pending: number;
  /** Tasks currently running. */
  readonly running: number;
}

interface TaskQueueOptions<T> {
  concurrency: number;
  /** Runs one task. It should handle its own failures; a rejection is logged and the queue moves on. */
  run: (item: T) => Promise<void>;
  /** Called each time the queue drains: nothing running and nothing waiting. */
  onIdle?: () => void;
}

export function createTaskQueue<T>({ concurrency, run, onIdle }: TaskQueueOptions<T>): TaskQueue<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
  }

  // Slots are filled as soon as they free up, so a task only ever waits here
  // while all `concurrency` slots are busy — removing one can't drain the queue.
  const waiting: T[] = [];
  let running = 0;

  const settle = () => {
    running -= 1;
    if (running === 0 && waiting.length === 0) {
      onIdle?.();
      return;
    }
    pump();
  };

  const pump = () => {
    while (running < concurrency && waiting.length > 0) {
      const item = waiting.shift() as T;
      running += 1;
      // Starting inside .then() also catches a `run` that throws synchronously.
      void Promise.resolve()
        .then(() => run(item))
        .catch((error: unknown) => {
          console.error('[task-queue] task failed:', error);
        })
        .finally(settle);
    }
  };

  return {
    push(...items) {
      waiting.push(...items);
      pump();
    },
    remove(predicate) {
      const index = waiting.findIndex(predicate);
      if (index === -1) return false;
      waiting.splice(index, 1);
      return true;
    },
    get pending() {
      return waiting.length;
    },
    get running() {
      return running;
    },
  };
}
