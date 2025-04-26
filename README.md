Okay, let's revamp the `README.md` based on the current library features and best practices, incorporating the strengths of the old README while updating it significantly.

# OSS-Ratelimit 🚀

[![npm version](https://img.shields.io/npm/v/oss-ratelimit.svg?style=flat-square)](https://www.npmjs.com/package/oss-ratelimit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[![Contribute](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

A robust, production-ready, open-source rate limiting library for Node.js & Next.js, built with TypeScript. Inspired by Upstash Ratelimit but with enhanced features, flexibility, and a powerful registry system.

**[📚 Read the Full Documentation](https://oss-ratelimit.vercel.app/docs)** <!-- Add link to your Fumadocs site -->

## Features ✨

*   **Multiple Algorithms**: Fixed Window, Sliding Window, and Token Bucket strategies out-of-the-box.
*   **Efficient Redis Backend**: Leverages Redis and Lua scripts for high-performance, distributed rate limiting.
*   **Client & Registry Management**: Easily manage multiple limiter configurations and efficiently reuse Redis connections.
*   **Ephemeral Cache**: Optional in-memory fallback during Redis outages (currently for Sliding Window) for improved resilience.
*   **Fail Open/Closed Strategy**: Configurable behavior during Redis connection issues.
*   **Analytics**: Optional tracking of request counts and throughput per identifier.
*   **Blocking Support**: Includes a `.block()` method to wait until a request is permitted.
*   **TypeScript First**: Strongly typed for a great developer experience.
*   **Next.js Ready**: Designed for easy integration with Next.js (Pages Router, App Router, Middleware) including IP detection utilities.
*   **Customizable**: Flexible configuration options for fine-tuning behavior.

## Installation 📦

Install the library and its peer dependency `redis`:

```bash
npm install oss-ratelimit redis
# or
yarn add oss-ratelimit redis
# or
pnpm add oss-ratelimit redis
```

You might also need types for Redis:

```bash
npm install -D @types/redis
# or
yarn add -D @types/redis
# or
pnpm add -D @types/redis
```

## Quick Start

While you can create single instances, **we strongly recommend using the Registry system (see below) for managing configurations and Redis clients efficiently in most applications.**

Here's a very basic example using a single instance:

```typescript filename="basic-example.ts"
import { createClient } from 'redis';
import { Ratelimit, slidingWindow, getRedisClient } from 'oss-ratelimit';

async function run() {
  // 1. Get a Redis client (using the helper is convenient)
  const redis = await getRedisClient({
    url: process.env.RATELIMIT_REDIS_URL || 'redis://localhost:6379'
  });
  // Ensure you handle connection errors from getRedisClient if needed

  // 2. Configure and create the limiter instance
  const limiter = new Ratelimit({
    redis, // The connected client
    limiter: slidingWindow(10, '10 s'), // Allow 10 requests per 10 seconds
    prefix: 'quickstart_app', // Optional prefix for keys
  });

  // 3. Apply the limit
  const identifier = 'user:123';
  const result = await limiter.limit(identifier);

  console.log(`Limit result for ${identifier}:`, result);
  // Example Output: { success: true, limit: 10, remaining: 9, reset: 1678886410000 }

  if (!result.success) {
    console.warn(`Rate limit exceeded for ${identifier}. Retry after ${result.retryAfter}s.`);
  }

  // Remember to disconnect the client when done
  await redis.quit();
}

run().catch(console.error);
```

## Recommended Usage: Registry System 🏗️

For managing multiple rate limits (e.g., different API tiers, login vs general API) and simplifying Redis client management, use the built-in registry.

**1. Initialize the Registry (`initRateLimit`)**

Define your limiter configurations in one place.

```typescript filename="src/lib/ratelimit.ts"
import {
  initRateLimit,
  RateLimitBuilder,
  RegisterConfigParam,
  slidingWindow,
  fixedWindow,
} from 'oss-ratelimit';

// Define unique names for your limiters
export type LimiterName = 'apiGeneral' | 'loginAttempts' | 'expensiveOp';

// Create the registry instance (configure default Redis connection)
export const rateLimiterRegistry: RateLimitBuilder<LimiterName> = initRateLimit<LimiterName>({
  defaultRedisOptions: {
    url: process.env.RATELIMIT_REDIS_URL || 'redis://localhost:6379',
  },
});

// Define configurations for each limiter name
export const limiterConfigs: Record<LimiterName, RegisterConfigParam> = {
  apiGeneral: {
    limiter: slidingWindow(50, '30 s'), // 50 req / 30 sec
    prefix: 'rl_api_gen',
    analytics: true,
  },
  loginAttempts: {
    limiter: fixedWindow(5, '15 m'), // 5 req / 15 min
    prefix: 'rl_login',
    failOpen: false, // Be strict on login attempts
  },
  expensiveOp: {
     limiter: fixedWindow(10, '1 h'), // 10 req / hour
     prefix: 'rl_expensive',
  }
};
```

**2. Initialize Limiters Eagerly (Recommended)**

Load configurations and connect to Redis on startup.

```typescript filename="src/server.ts" /* Or wherever your app starts */
import { rateLimiterRegistry, limiterConfigs } from './lib/ratelimit';
import { initializeLimiters } from 'oss-ratelimit';

async function startServer() {
  try {
    console.log("Initializing rate limiters...");
    // Initialize all limiters defined in the configs
    await initializeLimiters({
      registry: rateLimiterRegistry,
      configs: limiterConfigs,
      throwOnError: true, // Exit if any limiter fails to initialize
    });
    console.log("✅ Rate limiters initialized successfully.");

    // ... start your Express/Next.js/other server ...

  } catch (error) {
    console.error("💥 Failed to initialize rate limiters:", error);
    process.exit(1);
  }
}

startServer();
```

**3. Use the Limiter**

Access the specific limiter instance via the registry.

```typescript filename="src/routes/someApi.ts"
import { rateLimiterRegistry } from '@/lib/ratelimit'; // Adjust path
import { getIpFromRequest } from '@/utils/getIpFromRequest'; // See Docs for this util

// Example in an Express-like handler
async function handleRequest(req: Request, res: Response) {
  const ip = getIpFromRequest(req); // Implement IP detection
  if (!ip) return res.status(400).send('Cannot determine IP');

  try {
    // Get the specific limiter instance by name
    const limiter = rateLimiterRegistry.get('apiGeneral'); // Throws if not initialized

    const result = await limiter.limit(ip);

    // Add rate limit headers to response (recommended)
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    // ... other headers

    if (!result.success) {
      res.setHeader('Retry-After', result.retryAfter ?? 1);
      return res.status(429).send('Too Many Requests');
    }

    // Proceed with protected logic
    res.send('Success!');

  } catch (error) {
    console.error("Rate limit check failed:", error);
    res.status(500).send('Internal Server Error');
  }
}
```

**[➡️ Learn more about the Registry System in the Docs](YOUR_DOCS_URL/registry)**

## Available Limiters

Quick examples of configuring different algorithms:

### Fixed Window

```typescript
import { fixedWindow } from 'oss-ratelimit';
// 100 requests per minute
const limiterConfig = fixedWindow(100, '1 m');
```

### Sliding Window

```typescript
import { slidingWindow } from 'oss-ratelimit';
// 50 requests per 30 seconds (rolling window)
const limiterConfig = slidingWindow(50, '30 s');
```

### Token Bucket

```typescript
import { tokenBucket } from 'oss-ratelimit';
// Refill 5 tokens every 10 seconds, bucket capacity of 20
const limiterConfig = tokenBucket(5, '10 s', 20);
```

**[➡️ Read Algorithm Details in the Docs](https://oss-ratelimit.vercel.app/docs/03-core-concepts#algorithms-in-depth)**

## API Highlights

```typescript
const limiter = rateLimiterRegistry.get('apiGeneral');
const identifier = 'user:xyz';

// Check limit (consumes 1 request if successful)
const { success, limit, remaining, reset, retryAfter, pending, throughput } = await limiter.limit(identifier);

// Block until request is allowed (or timeout)
try {
  await limiter.block(identifier, { maxWaitMs: 3000 }); // Wait up to 3s
  // Proceed...
} catch (e) { /* Handle RateLimitExceededError */ }

// Reset the limit for an identifier
await limiter.reset(identifier);

// Check status without consuming request
const stats = await limiter.getStats(identifier); // { used, remaining, limit, reset }
const isAllowed = await limiter.check(identifier); // boolean
```

## Configuration

Key options when creating a `Ratelimit` instance or registering with the registry:

*   `redis`: Connected `RedisClientType` instance or `RedisOptions`.
*   `limiter`: Algorithm configuration (`fixedWindow(...)`, etc.).
*   `prefix`: String prefix for Redis keys (default: `open-ratelimit`).
*   `analytics`: `boolean` (default: `false`) - Enable extra metrics.
*   `timeout`: `number` (default: `1000`) - Redis command timeout (ms).
*   `ephemeralCache`: `boolean` (default: `true`) - Enable in-memory fallback (Sliding Window only).
*   `ephemeralCacheTTL`: `number` (default: `60000`) - TTL for cache entries (ms).
*   `failOpen`: `boolean` (default: `false`) - Allow requests if Redis fails?
*   `silent`: `boolean` (default: `false`) - Suppress warnings (e.g., cache usage).

**[➡️ See Full Configuration Options in the Docs](https://oss-ratelimit.vercel.app/docs/04-multiple-limiters-with-registry#configuration-options)**

## Error Handling ⚠️

The library uses specific error types:

*   `RatelimitError`: Base error class.
*   `RedisConnectionError`: Issues connecting/communicating with Redis (when `failOpen: false`).
*   `RateLimitExceededError`: Thrown by `.block()` on timeout.

Handle errors gracefully using `try...catch`:

```typescript
try {
  await limiter.limit("user-123");
} catch (error) {
  if (error instanceof RedisConnectionError) {
     console.error("Redis down!", error);
     // Return 503 or handle based on failOpen config
  } else if (error instanceof RatelimitError) {
    console.error("Rate limit configuration or operational error:", error);
    // Return 500
  } else {
    console.error("Unexpected error:", error);
    // Return 500
  }
}
```

**[➡️ Learn more about Error Handling & Events in the Docs](https://oss-ratelimit.vercel.app/docs/05.2-error-handling)**

## Next.js Integration

Easily integrate with Next.js API Routes, Middleware, or App Router Handlers. A utility function for reliable IP detection is recommended.

**[➡️ See Next.js Integration Guide in the Docs](https://oss-ratelimit.vercel.app/docs/05-nextjs-integration)**

## Contributing 🤝

Contributions are welcome! Please read the [Contributing Guidelines](CONTRIBUTING.md) before submitting a PR.

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/your-feature`).
3.  Commit your changes (`git commit -m 'feat: Add some feature'`).
4.  Push to the branch (`git push origin feature/your-feature`).
5.  Open a Pull Request.

## License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
