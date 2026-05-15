import { config } from '../config/index.js';
import logger from './logger.js';
import { recordQueued } from './metrics.js';

// Serialized async queue — prevents CPU thrashing when concurrency=1.
// Concurrency is configurable for GPU deployments (QUEUE_CONCURRENCY > 1).

class AsyncQueue {
  #running = 0;
  #pending = [];
  #concurrency;
  #maxPending;

  constructor(concurrency, maxPending) {
    this.#concurrency = concurrency;
    this.#maxPending = maxPending;
  }

  get pendingCount() { return this.#pending.length; }
  get runningCount() { return this.#running; }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      if (this.#pending.length >= this.#maxPending) {
        return reject(Object.assign(new Error('Queue full — server is overloaded, please retry later.'), { statusCode: 429 }));
      }
      this.#pending.push({ fn, resolve, reject });
      recordQueued(1);
      logger.debug({ pending: this.#pending.length, running: this.#running }, 'Task queued');
      this.#drain();
    });
  }

  #drain() {
    while (this.#running < this.#concurrency && this.#pending.length > 0) {
      const { fn, resolve, reject } = this.#pending.shift();
      recordQueued(-1);
      this.#running++;
      Promise.resolve()
        .then(() => fn())
        .then(resolve, reject)
        .finally(() => { this.#running--; this.#drain(); });
    }
  }
}

export const inferenceQueue = new AsyncQueue(
  config.queue.concurrency,
  config.queue.maxPending,
);
