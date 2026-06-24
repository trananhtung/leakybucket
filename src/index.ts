/** Thrown when the queue is full and a new request cannot be accepted. */
export class LeakyBucketFullError extends Error {
  constructor(message = "LeakyBucket queue is full") {
    super(message);
    this.name = "LeakyBucketFullError";
  }
}

/** Options for creating a LeakyBucket. */
export interface LeakyBucketOptions {
  /**
   * Maximum number of operations per second (throughput).
   * Must be a positive finite number.
   */
  rate: number;
  /**
   * Maximum number of requests that may queue up waiting for a slot.
   * Requests beyond this limit throw `LeakyBucketFullError`.
   * Default: `Infinity` (unbounded queue).
   */
  maxQueue?: number;
}

/**
 * Leaky-bucket rate limiter.
 *
 * Enforces a **constant throughput** of `rate` operations per second with no
 * burst allowance. Callers call `take()` to acquire a slot; if no slot is
 * immediately available, the call waits (queues) until the next slot opens.
 *
 * Unlike a token-bucket, leaky-bucket does not allow short bursts — every
 * operation is spaced exactly `1000 / rate` milliseconds apart.
 *
 * Inspired by Go's `uber-go/ratelimit` and the leaky-bucket algorithm used
 * in network traffic shaping.
 *
 * @example
 * const bucket = new LeakyBucket({ rate: 10 }); // 10 ops/sec
 * await bucket.take();  // wait for a slot, then proceed
 * await fetch(url);
 */
export class LeakyBucket {
  private readonly _interval: number; // ms between ops
  private readonly _maxQueue: number;
  /** Timestamp (ms) when the next operation slot opens. */
  private _nextTick: number;
  /** Number of requests currently waiting. */
  private _queued = 0;

  constructor(options: LeakyBucketOptions) {
    if (!Number.isFinite(options.rate) || options.rate <= 0) {
      throw new RangeError("LeakyBucket: rate must be a positive finite number");
    }
    this._interval = 1000 / options.rate;
    this._maxQueue = options.maxQueue ?? Infinity;
    this._nextTick = Date.now();
  }

  /**
   * Wait for the next available slot, then resolve.
   *
   * - If a slot is immediately available (no backlog), resolves without delay.
   * - Otherwise, waits in a FIFO queue — each waiter is spaced exactly
   *   `1000/rate` ms apart.
   * - If `signal` is already aborted, throws immediately.
   * - If `signal` is aborted while waiting, throws with the abort reason.
   * - If the queue is full (`maxQueue`), throws `LeakyBucketFullError`.
   *
   * @param signal Optional AbortSignal to cancel the wait.
   */
  take(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }

    const now = Date.now();
    const delay = Math.max(0, this._nextTick - now);

    if (delay === 0) {
      this._nextTick = now + this._interval;
      return Promise.resolve();
    }

    if (this._queued >= this._maxQueue) {
      return Promise.reject(
        new LeakyBucketFullError(`LeakyBucket queue is full (maxQueue=${this._maxQueue})`)
      );
    }

    this._nextTick += this._interval;
    this._queued++;

    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;

      const onAbort = () => {
        clearTimeout(timer);
        this._queued--;
        reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
      };

      timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        this._queued--;
        resolve();
      }, delay);

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Immediately reset the bucket — clears the internal clock so the next
   * `take()` call proceeds without waiting.
   *
   * Note: in-flight `take()` Promises that are already queued will still
   * resolve at their scheduled times (they hold their own timer references).
   * Call `drain()` only when you intend to discard all pending work.
   */
  drain(): void {
    this._nextTick = Date.now();
  }

  /**
   * The current rate in operations per second.
   */
  get rate(): number {
    return 1000 / this._interval;
  }

  /**
   * The interval between consecutive operations in milliseconds.
   */
  get interval(): number {
    return this._interval;
  }

  /**
   * Number of requests currently waiting in the queue.
   */
  get queueSize(): number {
    return this._queued;
  }

  /**
   * Milliseconds until the next slot is available.
   * Returns `0` if a slot is available immediately.
   */
  get waitTime(): number {
    return Math.max(0, this._nextTick - Date.now());
  }

  /**
   * Wrap an async function so each invocation automatically acquires a slot
   * before calling the original function.
   *
   * @example
   * const limited = bucket.wrap(fetch);
   * await limited(url); // rate-limited
   */
  wrap<Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>
  ): (...args: Args) => Promise<R> {
    return async (...args: Args) => {
      await this.take();
      return fn(...args);
    };
  }
}

/**
 * Create a `LeakyBucket` instance.
 *
 * @example
 * const bucket = leakyBucket({ rate: 10 }); // 10 ops/sec
 * await bucket.take();
 */
export function leakyBucket(options: LeakyBucketOptions): LeakyBucket {
  return new LeakyBucket(options);
}
