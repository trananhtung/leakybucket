# leakybucket

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)

[![npm](https://img.shields.io/npm/v/leakybucket)](https://www.npmjs.com/package/leakybucket)
[![CI](https://github.com/trananhtung/leakybucket/actions/workflows/ci.yml/badge.svg)](https://github.com/trananhtung/leakybucket/actions)
[![license](https://img.shields.io/npm/l/leakybucket)](LICENSE)

Zero-dependency leaky-bucket rate limiter for Node.js and browsers. Enforces a **constant throughput rate** — no bursts. TypeScript, ESM + CJS, AbortSignal.

```bash
npm install leakybucket
```

## Why leaky-bucket?

Unlike a token-bucket (which allows short bursts), a leaky-bucket enforces a **uniform spacing** of `1000/rate` ms between operations. This is what you want when calling external APIs with strict rate limits, throttling database writes, or shaping egress traffic.

| | Token-bucket | Leaky-bucket |
|---|---|---|
| Burst allowed | ✅ yes | ❌ no |
| Constant spacing | ❌ no | ✅ yes |
| API rate limit compliance | risky | safe |

**Prior art on npm:** `ts-leaky-bucket` was abandoned June 2020 (22 downloads/week), `linaGirl/leaky-bucket` last commit October 2021. `leakybucket` is the maintained, zero-dep TypeScript replacement.

Inspired by Go's [`uber-go/ratelimit`](https://github.com/uber-go/ratelimit).

## Quick start

```ts
import { LeakyBucket } from "leakybucket";

const bucket = new LeakyBucket({ rate: 10 }); // 10 ops/sec → 1 op every 100ms

async function callApi(url: string) {
  await bucket.take(); // waits for next slot, then proceeds
  return fetch(url);
}

// 50 concurrent calls — all proceed in order, spaced 100ms apart
await Promise.all(urls.map(callApi));
```

## API

### `new LeakyBucket(options)`

```ts
interface LeakyBucketOptions {
  rate: number;       // operations per second (required, must be > 0)
  maxQueue?: number;  // max pending requests (default: Infinity)
}
```

```ts
const bucket = new LeakyBucket({ rate: 5 });        // 5/sec
const bucket = new LeakyBucket({ rate: 100 });       // 100/sec = 10ms interval
const bucket = new LeakyBucket({ rate: 10, maxQueue: 50 }); // bounded queue
```

### `bucket.take(signal?): Promise<void>`

Acquire a slot. Resolves when it is safe to proceed.

- If no backlog: resolves immediately.
- If backlogged: waits in FIFO order until the next slot opens.
- If `signal` is already aborted: rejects immediately.
- If aborted while waiting: rejects and removes itself from the queue.
- If queue is full (`maxQueue`): rejects with `LeakyBucketFullError`.

```ts
await bucket.take();                   // simple usage
await bucket.take(abortController.signal); // cancellable
```

### `bucket.wrap(fn): limitedFn`

Wraps an async function so each call automatically acquires a slot first.

```ts
const limitedFetch = bucket.wrap(fetch);
const response = await limitedFetch(url); // rate-limited
```

### `bucket.drain()`

Reset the internal clock so the next `take()` proceeds immediately. Useful after a pause or when you want to flush the "debt" without waiting.

### Properties

| Property | Description |
|----------|-------------|
| `bucket.rate` | Configured ops/sec |
| `bucket.interval` | Ms between ops (`1000 / rate`) |
| `bucket.queueSize` | Number of calls currently waiting |
| `bucket.waitTime` | Ms until next slot is available |

### `leakyBucket(options)` factory

Convenience function for the `new LeakyBucket(...)` constructor.

```ts
import { leakyBucket } from "leakybucket";
const bucket = leakyBucket({ rate: 10 });
```

### `LeakyBucketFullError`

Thrown when `maxQueue` is set and the queue is at capacity.

```ts
import { LeakyBucketFullError } from "leakybucket";

try {
  await bucket.take();
} catch (e) {
  if (e instanceof LeakyBucketFullError) {
    console.error("Too many pending requests");
  }
}
```

## Examples

### API rate limiting with AbortSignal

```ts
import { LeakyBucket } from "leakybucket";

const bucket = new LeakyBucket({ rate: 10, maxQueue: 100 });
const controller = new AbortController();

async function fetchWithRateLimit(url: string) {
  await bucket.take(controller.signal);
  return fetch(url, { signal: controller.signal });
}

// Cancel all pending requests
controller.abort();
```

### Wrapping a function

```ts
import { LeakyBucket } from "leakybucket";

const bucket = new LeakyBucket({ rate: 5 });
const limitedSendEmail = bucket.wrap(sendEmail);

// 100 emails sent at most 5/second, in order
for (const email of emails) {
  await limitedSendEmail(email);
}
```

### Monitoring queue depth

```ts
import { LeakyBucket } from "leakybucket";

const bucket = new LeakyBucket({ rate: 10 });

setInterval(() => {
  console.log(`Queue: ${bucket.queueSize}, Wait: ${bucket.waitTime}ms`);
}, 1000);
```

## Comparison

| Package | Downloads/week | Last release | TypeScript | Zero-dep |
|---------|---------------|--------------|------------|----------|
| **leakybucket** | — | 2024 | ✅ | ✅ |
| ts-leaky-bucket | ~22 | **2020 (abandoned)** | ❌ | ✅ |
| leaky-bucket | ~800 | **2021 (abandoned)** | ❌ | ❌ |
| limiter | ~65k | 2023 | partial | ✅ (sliding window, not leaky) |

## Contributors ✨

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome — code, docs, bug reports, ideas, reviews! See the [emoji key](https://allcontributors.org/docs/en/emoji-key) for how each contribution is recognized, and open a PR or issue to get involved.

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/trananhtung"><img src="https://avatars.githubusercontent.com/u/30992229?v=4?s=100" width="100px;" alt="Tung Tran"/><br /><sub><b>Tung Tran</b></sub></a><br /><a href="https://github.com/trananhtung/./commits?author=trananhtung" title="Code">💻</a> <a href="#maintenance-trananhtung" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT
