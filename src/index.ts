import { type RedisClientType, createClient } from 'redis';
import { Ratelimit } from './rate-limit';
import {
  FixedWindowOptions,
  LimiterType,
  RatelimitConfig,
  SlidingWindowOptions,
  TimeWindow,
  TokenBucketOptions,
} from './types';
import { parseTimeWindow } from './utils';
export { Ratelimit };
// Enhanced error handling
export class RatelimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatelimitError';
  }
}

// Limiter functions
export const fixedWindow = (limit: number, window: TimeWindow): FixedWindowOptions => {
  return {
    limit,
    interval: parseTimeWindow(window),
  };
};

export const slidingWindow = (limit: number, window: TimeWindow): SlidingWindowOptions => {
  return {
    limit,
    interval: parseTimeWindow(window),
  };
};

export const tokenBucket = (
  refillRate: number,
  interval: TimeWindow,
  limit: number
): TokenBucketOptions => {
  return {
    refillRate,
    interval: parseTimeWindow(interval),
    limit,
  };
};

let redisClient: RedisClientType | undefined;
export const getRedisSingleClient = (envRedisKey: string) => {
  if (redisClient) {
    return redisClient;
  }
  redisClient = createClient({
    url: process.env[envRedisKey] || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  }) as RedisClientType;
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  // Connect automatically
  (async () => {
    try {
      if (!redisClient.isOpen || !(await redisClient.ping())) {
        await redisClient.connect();
      }
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
    }
  })();
  return redisClient;
};
// Factory function
export interface CreateRateLimiterProps extends Omit<RatelimitConfig, 'redis'> {}

export const createSingletonRateLimiter = (
  props?: CreateRateLimiterProps & {
    limiter?: LimiterType;
    envRedisKey?: string;
  }
) => {
  const redis = getRedisSingleClient(props?.envRedisKey ?? 'REDIS_URL');
  return createRateLimiter(redis, props);
};

export const createRateLimiter = (
  redis: RedisClientType,
  props?: CreateRateLimiterProps & {
    limiter?: LimiterType;
    envRedisKey?: string;
  }
) => {
  return new Ratelimit({
    redis,
    limiter: props?.limiter ?? slidingWindow(10, '10 s'),
    prefix: props?.prefix ?? 'open-ratelimit',
    analytics: props?.analytics ?? false,
    timeout: props?.timeout ?? 1000,
    ephemeralCache: props?.ephemeralCache ?? true,
    ephemeralCacheTTL: props?.ephemeralCacheTTL ?? 60000,
  });
};
