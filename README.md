# Redis Rate Limiter 🚀

A robust Redis-based rate limiting library inspired by Upstash's design, supporting multiple algorithms with enhanced error handling and analytics.

## Features ✨

- **Multiple Algorithms**: Fixed Window, Sliding Window, and Token Bucket strategies
- **Redis Integration**: Distributed rate limiting with Redis backend
- **Analytics**: Optional request metrics (throughput, pending requests)
- **Ephemeral Cache**: In-memory fallback during Redis outages
- **Error Resilience**: Graceful degradation and fail-open mechanisms
- **Blocking Support**: `block()` method to wait until request allowed
- **TypeScript Ready**: Full type definitions included

## Installation 📦

```bash
npm install @oss/redis-ratelimit redis
```


```ts
import { createClient } from 'redis';
import { Ratelimit, slidingWindow } from '@oss/redis-ratelimit';

const redis = createClient({ url: 'redis://localhost:6379' });
await redis.connect();

const limiter = new Ratelimit({
  redis,
  limiter: slidingWindow(10, '10 s'),
});

const result = await limiter.limit('user:123');
console.log(result);
```

### Singleton Rate Limiter

```ts
import { createSingletonRateLimiter } from '@oss/redis-ratelimit';

const limiter = createSingletonRateLimiter({
  limiter: { limit: 20, interval: 60000 },
  envRedisKey: 'REDIS_URL',
});

const res = await limiter.limit('user:456');
console.log(res);
```

## Available Limiters

### Fixed Window
```ts
import { fixedWindow } from '@oss/redis-ratelimit';
const limiter = fixedWindow(100, '1 m');
```

### Sliding Window
```ts
import { slidingWindow } from '@oss/redis-ratelimit';
const limiter = slidingWindow(50, '30 s');
```

### Token Bucket
```ts
import { tokenBucket } from '@oss/redis-ratelimit';
const limiter = tokenBucket(5, '10 s', 20);
```

## Environment Variables
- `REDIS_URL` - Redis connection URL. (only needed when you use 'createSingletonRateLimiter')

## Error Handling ⚠️
 **RatelimitError**: The library throws RatelimitError for:
- Invalid configurations

- Redis connection failures

- Script execution errors

Fail-Open Strategy: Returns success: true with conservative estimates when Redis is unavailable.
```ts
try {
  await ratelimiter.limit("user-123");
} catch (error) {
  if (error instanceof RatelimitError) {
    // Handle specific rate limit errors
  }
}
```
### Advanced Usage 🔍

```ts
// Wait up to 5 seconds
const response = await ratelimiter.block("user-123", 5000);
```
#### Reset Limits
Clear all limits for a user
```ts
await ratelimiter.reset("user-123");
```

### Analytics Data
```ts
const {
  throughput, // Requests in last second
  pending,    // Current queue size
  remaining,  // Remaining requests
  reset       // Unix timestamp of next reset
} = await ratelimiter.limit("user-123");
```

### Ephemeral Cache 🛡️
- Automatically activates when Redis connection fails:

- In-memory sliding window implementation

- Configurable TTL (default: 60 seconds)

- Periodic cleanup of expired entries
```ts
createSingletonRateLimiter({
  ephemeralCache: true,
  ephemeralCacheTTL: 30000 // 30 seconds
})
```

### Contributing 🤝
- Fork the repository

- Create your feature branch (git checkout -b feature/amazing-feature)

- Commit your changes (git commit -m 'Add some amazing feature')

- Push to the branch (git push origin feature/amazing-feature)

- Open a Pull Request



## License
MIT
