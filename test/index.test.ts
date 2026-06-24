import { jest } from "@jest/globals";
import { LeakyBucket, LeakyBucketFullError, leakyBucket } from "../src/index.js";

// Use fake timers for all tests
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

// ── construction ──────────────────────────────────────────────────────────────
describe("construction", () => {
  it("creates with valid rate", () => {
    const b = new LeakyBucket({ rate: 10 });
    expect(b.rate).toBe(10);
    expect(b.interval).toBe(100);
  });

  it("leakyBucket() factory works", () => {
    const b = leakyBucket({ rate: 5 });
    expect(b).toBeInstanceOf(LeakyBucket);
    expect(b.rate).toBe(5);
  });

  it("throws RangeError for non-positive rate", () => {
    expect(() => new LeakyBucket({ rate: 0 })).toThrow(RangeError);
    expect(() => new LeakyBucket({ rate: -1 })).toThrow(RangeError);
  });

  it("throws RangeError for Infinity rate", () => {
    expect(() => new LeakyBucket({ rate: Infinity })).toThrow(RangeError);
  });

  it("queueSize starts at 0", () => {
    expect(new LeakyBucket({ rate: 10 }).queueSize).toBe(0);
  });
});

// ── immediate slot ────────────────────────────────────────────────────────────
describe("immediate slot", () => {
  it("resolves immediately when no backlog", async () => {
    const b = new LeakyBucket({ rate: 10 });
    let resolved = false;
    const p = b.take().then(() => { resolved = true; });
    // Flush microtasks — immediate take() needs no timer
    await Promise.resolve();
    expect(resolved).toBe(true);
    await p;
  });

  it("does not increment queueSize for immediate slot", async () => {
    const b = new LeakyBucket({ rate: 10 });
    const p = b.take();
    expect(b.queueSize).toBe(0);
    await p;
  });
});

// ── queuing ───────────────────────────────────────────────────────────────────
describe("queuing", () => {
  it("queues subsequent takes", () => {
    const b = new LeakyBucket({ rate: 10 }); // 100ms interval
    b.take(); // immediate
    b.take(); // queued
    b.take(); // queued
    expect(b.queueSize).toBe(2);
  });

  it("resolves queued takes after interval elapses", async () => {
    const b = new LeakyBucket({ rate: 10 }); // 100ms interval
    const order: number[] = [];

    const p1 = b.take().then(() => order.push(1));
    const p2 = b.take().then(() => order.push(2));
    const p3 = b.take().then(() => order.push(3));

    // p1 is immediate
    await p1;
    expect(order).toEqual([1]);
    expect(b.queueSize).toBe(2);

    // Advance 100ms → p2 fires
    jest.advanceTimersByTime(100);
    await p2;
    expect(order).toEqual([1, 2]);

    // Advance 100ms → p3 fires
    jest.advanceTimersByTime(100);
    await p3;
    expect(order).toEqual([1, 2, 3]);
    expect(b.queueSize).toBe(0);
  });

  it("each queued take reduces queueSize on resolution", async () => {
    const b = new LeakyBucket({ rate: 10 });
    b.take();
    const p2 = b.take();
    expect(b.queueSize).toBe(1);
    jest.advanceTimersByTime(100);
    await p2;
    expect(b.queueSize).toBe(0);
  });
});

// ── maxQueue ──────────────────────────────────────────────────────────────────
describe("maxQueue", () => {
  it("throws LeakyBucketFullError when queue is full", async () => {
    const b = new LeakyBucket({ rate: 10, maxQueue: 2 });
    b.take(); // immediate
    b.take(); // queue 1
    b.take(); // queue 2
    await expect(b.take()).rejects.toBeInstanceOf(LeakyBucketFullError);
  });

  it("allows up to maxQueue pending", () => {
    const b = new LeakyBucket({ rate: 10, maxQueue: 3 });
    b.take(); // immediate
    b.take(); // 1
    b.take(); // 2
    b.take(); // 3
    expect(b.queueSize).toBe(3);
  });

  it("LeakyBucketFullError has correct name", async () => {
    const b = new LeakyBucket({ rate: 10, maxQueue: 0 });
    b.take(); // immediate, no queue
    try {
      await b.take();
    } catch (e) {
      expect((e as Error).name).toBe("LeakyBucketFullError");
    }
  });
});

// ── drain ─────────────────────────────────────────────────────────────────────
describe("drain", () => {
  it("drain resets the clock so next take is immediate", async () => {
    const b = new LeakyBucket({ rate: 10 });
    b.take(); // uses up the immediate slot

    // Without drain, next take would wait 100ms
    b.drain();

    let resolved = false;
    const p = b.take().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(true);
    await p;
  });
});

// ── AbortSignal ───────────────────────────────────────────────────────────────
describe("AbortSignal", () => {
  it("throws immediately if signal is already aborted", async () => {
    const b = new LeakyBucket({ rate: 10 });
    b.take(); // use immediate slot
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(b.take(ctrl.signal)).rejects.toBeDefined();
  });

  it("rejects when signal is aborted while waiting", async () => {
    const b = new LeakyBucket({ rate: 10 });
    b.take(); // use slot, next take will queue

    const ctrl = new AbortController();
    const p = b.take(ctrl.signal);

    expect(b.queueSize).toBe(1);
    ctrl.abort();

    await expect(p).rejects.toBeDefined();
    expect(b.queueSize).toBe(0);
  });

  it("does not throw for a non-aborted signal", async () => {
    const b = new LeakyBucket({ rate: 10 });
    const ctrl = new AbortController();
    await expect(b.take(ctrl.signal)).resolves.toBeUndefined();
  });
});

// ── waitTime ──────────────────────────────────────────────────────────────────
describe("waitTime", () => {
  it("returns 0 when slot is immediately available", () => {
    const b = new LeakyBucket({ rate: 10 });
    expect(b.waitTime).toBe(0);
  });

  it("returns positive after slot is consumed", () => {
    const b = new LeakyBucket({ rate: 10 }); // 100ms
    b.take();
    expect(b.waitTime).toBeGreaterThan(0);
    expect(b.waitTime).toBeLessThanOrEqual(100);
  });
});

// ── wrap ─────────────────────────────────────────────────────────────────────
describe("wrap", () => {
  it("wraps an async function", async () => {
    const b = new LeakyBucket({ rate: 100 });
    const fn = jest.fn(async (x: number) => x * 2);
    const limited = b.wrap(fn);

    const result = await limited(21);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledWith(21);
  });

  it("wrap respects rate limiting", async () => {
    const b = new LeakyBucket({ rate: 10 }); // 100ms
    const fn = async (n: number) => n;
    const limited = b.wrap(fn);

    const p1 = limited(1);
    const p2 = limited(2);
    const p3 = limited(3);

    expect(await p1).toBe(1);

    jest.advanceTimersByTime(100);
    expect(await p2).toBe(2);

    jest.advanceTimersByTime(100);
    expect(await p3).toBe(3);
  });
});

// ── interval accuracy ─────────────────────────────────────────────────────────
describe("interval accuracy", () => {
  it("computes correct interval for various rates", () => {
    expect(new LeakyBucket({ rate: 1 }).interval).toBe(1000);
    expect(new LeakyBucket({ rate: 2 }).interval).toBe(500);
    expect(new LeakyBucket({ rate: 10 }).interval).toBe(100);
    expect(new LeakyBucket({ rate: 100 }).interval).toBe(10);
  });
});
