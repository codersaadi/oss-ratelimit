import { RedisClientType } from 'redis';

export type TimeWindow =
  | `${number} ms`
  | `${number} s`
  | `${number} m`
  | `${number} h`
  | `${number} d`;

// Limiter types to match Upstash's API
export interface FixedWindowOptions {
  interval: number;
  limit: number;
}

export interface SlidingWindowOptions {
  interval: number;
  limit: number;
}

export interface TokenBucketOptions {
  refillRate: number;
  interval: number;
  limit: number;
}
// Response interface with analytics
export interface RatelimitResponse {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
  pending?: number;
  throughput?: number;
}
// Configuration interface
export interface RatelimitConfig {
  redis: RedisClientType | Promise<RedisClientType>;
  limiter: LimiterType;
  prefix?: string;
  analytics?: boolean;
  timeout?: number;
  ephemeralCache?: boolean;
  ephemeralCacheTTL?: number;
}
// Type for limiter algorithm
export type LimiterType = FixedWindowOptions | SlidingWindowOptions | TokenBucketOptions;
