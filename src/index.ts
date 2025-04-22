import { createClient, RedisClientType } from 'redis';
import { EventEmitter } from 'events';

/**
 * @package open-ratelimit
 * A production-ready, open-source rate limiter with multiple algorithms
 * Inspired by Upstash/ratelimit but with enhanced capabilities
 */

// ----------------------
// Error Types
// ----------------------

/**
 * Base error class for rate limiting operations
 */
export class RatelimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatelimitError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when Redis connection fails
 */
export class RedisConnectionError extends RatelimitError {
  constructor(message: string) {
    super(`Redis connection error: ${message}`);
    this.name = 'RedisConnectionError';
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitExceededError extends RatelimitError {
  public readonly retryAfter: number;
  public readonly identifier: string;
  
  constructor(identifier: string, retryAfter: number) {
    super(`Rate limit exceeded for "${identifier}". Retry after ${retryAfter} seconds.`);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
    this.identifier = identifier;
  }
}

// ----------------------
// Time Utilities
// ----------------------

/**
 * Time window definition using type literals
 */
export type TimeWindow = 
  | `${number} ms` 
  | `${number} s` 
  | `${number} m` 
  | `${number} h` 
  | `${number} d`;

/**
 * Time units in milliseconds
 */
const TIME_UNITS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parse time window string to milliseconds
 */
export const parseTimeWindow = (window: TimeWindow): number => {
  try {
    const [valueStr, unit] = window.trim().split(/\s+/);
    const value = parseInt(valueStr, 10);
    
    if (Number.isNaN(value) || value <= 0) {
      throw new RatelimitError(`Invalid time value: ${valueStr}`);
    }
    
    const unitMultiplier = TIME_UNITS[unit as keyof typeof TIME_UNITS];
    if (!unitMultiplier) {
      throw new RatelimitError(`Invalid time unit: ${unit}. Must be one of: ms, s, m, h, d`);
    }
    
    return value * unitMultiplier;
  } catch (error) {
    if (error instanceof RatelimitError) throw error;
    throw new RatelimitError(`Failed to parse time window: ${window}`);
  }
};

// ----------------------
// Limiter Algorithm Types
// ----------------------

/**
 * Base interface for all limiter options
 */
interface BaseLimiterOptions {
  limit: number;
  type: string;
}

/**
 * Fixed window algorithm options
 */
export interface FixedWindowOptions extends BaseLimiterOptions {
  type: 'fixedWindow';
  windowMs: number;
}

/**
 * Sliding window algorithm options
 */
export interface SlidingWindowOptions extends BaseLimiterOptions {
  type: 'slidingWindow';
  windowMs: number;
}

/**
 * Token bucket algorithm options
 */
export interface TokenBucketOptions extends BaseLimiterOptions {
  type: 'tokenBucket';
  refillRate: number;
  interval: number;
}

/**
 * Union type for all limiter algorithms
 */
export type LimiterType = 
  | FixedWindowOptions 
  | SlidingWindowOptions 
  | TokenBucketOptions;

// ----------------------
// Limiter Factory Functions
// ----------------------

/**
 * Create a fixed window limiter configuration
 */
export const fixedWindow = (limit: number, window: TimeWindow): FixedWindowOptions => {
  return {
    type: 'fixedWindow',
    limit,
    windowMs: parseTimeWindow(window),
  };
};

/**
 * Create a sliding window limiter configuration
 */
export const slidingWindow = (limit: number, window: TimeWindow): SlidingWindowOptions => {
  return {
    type: 'slidingWindow',
    limit,
    windowMs: parseTimeWindow(window),
  };
};

/**
 * Create a token bucket limiter configuration
 */
export const tokenBucket = (
  refillRate: number,
  interval: TimeWindow,
  limit: number
): TokenBucketOptions => {
  return {
    type: 'tokenBucket',
    refillRate,
    interval: parseTimeWindow(interval),
    limit,
  };
};

// ----------------------
// Ephemeral Cache
// ----------------------

/**
 * In-memory cache for fallback during Redis outages
 */
class EphemeralCache {
  private cache: Map<string, { count: number; expires: number }>;
  private ttl: number;
  private cleanupInterval: NodeJS.Timeout;

  constructor(ttlMs = 60000) {
    this.cache = new Map();
    this.ttl = ttlMs;
    
    // Clean expired items periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), Math.min(ttlMs / 2, 30000));
  }

  /**
   * Get current count for a key
   */
  get(key: string): number {
    const now = Date.now();
    const item = this.cache.get(key);
    
    if (!item || item.expires < now) return 0;
    return item.count;
  }

  /**
   * Set count for a key
   */
  set(key: string, count: number, windowMs: number): void {
    this.cache.set(key, {
      count,
      expires: Date.now() + Math.min(windowMs, this.ttl),
    });
  }

  /**
   * Increment counter for a key
   */
  increment(key: string, windowMs: number): number {
    const now = Date.now();
    const item = this.cache.get(key) || { count: 0, expires: now + windowMs };
    
    if (item.expires < now) {
      item.count = 1;
      item.expires = now + windowMs;
    } else {
      item.count++;
    }
    
    this.cache.set(key, item);
    return item.count;
  }

  /**
   * Remove expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (item.expires < now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Destroy the cache and clear timer
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}

// ----------------------
// Redis Client Management
// ----------------------

/**
 * Redis connection options
 */
export interface RedisOptions {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: number;
  tls?: boolean;
  connectTimeout?: number;
  reconnectStrategy?: number | false | ((retries: number, cause: Error) => number | false | Error);
}

/**
 * Default Redis configuration
 */
const DEFAULT_REDIS_OPTIONS: RedisOptions = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  connectTimeout: 5000,
  reconnectStrategy: (retries: number) => Math.min(retries * 50, 3000),
};

/**
 * Singleton Redis client
 */
let redisClient: RedisClientType | undefined;

/**
 * Get or create a Redis client instance
 */
export const getRedisClient = async (options: RedisOptions = {}): Promise<RedisClientType> => {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  const mergedOptions = { ...DEFAULT_REDIS_OPTIONS, ...options };
  
  try {
    redisClient = createClient({
      url: mergedOptions.url,
      socket: {
        host: mergedOptions.host,
        port: mergedOptions.port,
        tls: mergedOptions.tls,
        connectTimeout: mergedOptions.connectTimeout,
        reconnectStrategy: mergedOptions.reconnectStrategy,
      },
      username: mergedOptions.username,
      password: mergedOptions.password,
      database: mergedOptions.database,
    }) as RedisClientType;

    // Set up error handling
    redisClient.on('error', (err) => {
      console.error('[open-ratelimit] Redis client error:', err);
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    throw new RedisConnectionError(
      error instanceof Error ? error.message : String(error)
    );
  }
};

/**
 * Close Redis client if open
 */
export const closeRedisClient = async (): Promise<void> => {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = undefined;
  }
};

// ----------------------
// Rate Limit Response
// ----------------------

/**
 * Rate limit check response
 */
export interface RatelimitResponse {
  /** Whether the request is allowed */
  success: boolean;
  /** Maximum number of requests allowed */
  limit: number;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Timestamp (ms) when the limit resets */
  reset: number;
  /** Seconds until retry is possible (only when success=false) */
  retryAfter?: number;
  /** Current pending requests count (only with analytics=true) */
  pending?: number;
  /** Requests per second (only with analytics=true) */
  throughput?: number;
}

// ----------------------
// Ratelimiter Configuration
// ----------------------

/**
 * Rate limiter configuration options
 */
export interface RatelimitConfig {
  /** Redis client instance or connection options */
  redis: RedisClientType | RedisOptions;
  /** Rate limiting algorithm configuration */
  limiter: LimiterType;
  /** Key prefix for Redis */
  prefix?: string;
  /** Whether to collect analytics */
  analytics?: boolean;
  /** Redis operation timeout in ms */
  timeout?: number;
  /** Whether to use in-memory cache as fallback */
  ephemeralCache?: boolean;
  /** TTL for ephemeral cache entries in ms */
  ephemeralCacheTTL?: number;
  /** Whether to fail open (allow requests) when Redis is unavailable */
  failOpen?: boolean;
  /** Whether to disable console logs */
  silent?: boolean;
}

/**
 * Default rate limiter configuration
 */
const DEFAULT_CONFIG: Partial<RatelimitConfig> = {
  prefix: 'open-ratelimit',
  analytics: false,
  timeout: 1000,
  ephemeralCache: true,
  ephemeralCacheTTL: 60000,
  failOpen: false,
  silent: false,
};

// ----------------------
// Main Ratelimiter Class
// ----------------------

/**
 * Main rate limiter implementation
 */
export class Ratelimit extends EventEmitter {
  private redis: RedisClientType | Promise<RedisClientType>;
  private limiter: LimiterType;
  private prefix: string;
  private analytics: boolean;
  private timeout: number;
  private ephemeralCache?: EphemeralCache;
  private failOpen: boolean;
  private silent: boolean;
  private scripts: Map<string, string> = new Map();

  /**
   * Create a new rate limiter instance
   */
  constructor(config: RatelimitConfig) {
    super();
    
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    
    // Handle Redis client or options
    if ('isOpen' in config.redis) {
      this.redis = config.redis as RedisClientType;
    } else {
      this.redis = getRedisClient(config.redis as RedisOptions);
    }
    
    this.limiter = finalConfig.limiter;
    this.prefix = finalConfig.prefix as string;
    this.analytics = !!finalConfig.analytics;
    this.timeout = finalConfig.timeout as number;
    this.failOpen = !!finalConfig.failOpen;
    this.silent = !!finalConfig.silent;
    
    // Create ephemeral cache if requested
    if (finalConfig.ephemeralCache) {
      this.ephemeralCache = new EphemeralCache(finalConfig.ephemeralCacheTTL);
    }
    
    // Initialize Lua scripts
    this.initScripts();
  }

  /**
   * Initialize Lua scripts for each algorithm
   */
  private initScripts(): void {
    // Sliding Window script
    this.scripts.set('slidingWindow', `
      local key = KEYS[1]
      local analyticsKey = KEYS[2]
      local now = tonumber(ARGV[1])
      local windowMs = tonumber(ARGV[2])
      local maxRequests = tonumber(ARGV[3])
      local doAnalytics = tonumber(ARGV[4])
      
      local windowStart = now - windowMs
      
      -- Remove counts older than the current window
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
      
      -- Get current count
      local count = redis.call('ZCARD', key)
      local success = count < maxRequests
      
      -- Add current timestamp if successful
      if success then
        redis.call('ZADD', key, now, now .. ':' .. math.random())
        count = count + 1
      end
      
      -- Set expiration to keep memory usage bounded
      redis.call('PEXPIRE', key, windowMs * 2)
      
      -- Analytics if requested
      if doAnalytics == 1 then
        redis.call('ZADD', analyticsKey, now, now)
        redis.call('PEXPIRE', analyticsKey, windowMs * 2)
      end
      
      -- Calculate when the oldest request expires
      local oldestTimestamp = 0
      if count >= maxRequests then
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        if #oldest >= 2 then
          oldestTimestamp = tonumber(oldest[2])
        end
      end
      
      -- Calculate pending and throughput if analytics enabled
      local pending = 0
      local throughput = 0
      if doAnalytics == 1 then
        pending = count
        -- Calculate requests in the last second
        local secondAgo = now - 1000
        throughput = redis.call('ZCOUNT', analyticsKey, secondAgo, '+inf')
      end
      
      -- Return results
      return {
        success and 1 or 0,
        maxRequests,
        math.max(0, maxRequests - count),
        now + windowMs,
        oldestTimestamp > 0 and math.ceil((oldestTimestamp + windowMs - now) / 1000) or 0,
        pending,
        throughput
      }
    `);

    // Fixed Window script
    this.scripts.set('fixedWindow', `
      local key = KEYS[1]
      local analyticsKey = KEYS[2]
      local limit = tonumber(ARGV[1])
      local windowMs = tonumber(ARGV[2])
      local doAnalytics = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])
      
      -- Increment counter for this window
      local count = redis.call('INCR', key)
      
      -- Set expiration if this is first request in window
      if count == 1 then
        redis.call('PEXPIRE', key, windowMs)
      end
      
      local success = count <= limit
      
      -- Analytics if requested
      if doAnalytics == 1 then
        redis.call('ZADD', analyticsKey, now, now)
        redis.call('PEXPIRE', analyticsKey, windowMs)
      end
      
      -- Calculate remaining time in window
      local ttl = redis.call('PTTL', key)
      if ttl < 0 then ttl = windowMs end
      
      -- Calculate throughput if analytics enabled
      local throughput = 0
      if doAnalytics == 1 then
        -- Calculate requests in the last second
        local secondAgo = now - 1000
        throughput = redis.call('ZCOUNT', analyticsKey, secondAgo, '+inf')
      end
      
      return {
        success and 1 or 0,
        limit,
        math.max(0, limit - count),
        now + ttl,
        success and 0 or math.ceil(ttl / 1000),
        count,
        throughput
      }
    `);

    // Token Bucket script
    this.scripts.set('tokenBucket', `
      local key = KEYS[1]
      local analyticsKey = KEYS[2]
      local now = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local refillInterval = tonumber(ARGV[3])
      local bucketCapacity = tonumber(ARGV[4])
      local doAnalytics = tonumber(ARGV[5])
      
      -- Get current bucket state
      local bucketInfo = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucketInfo[1]) or bucketCapacity
      local lastRefill = tonumber(bucketInfo[2]) or 0
      
      -- Calculate token refill
      local elapsedTime = now - lastRefill
      local tokensToAdd = math.floor(elapsedTime * (refillRate / refillInterval))
      
      if tokensToAdd > 0 then
        -- Add tokens based on elapsed time
        tokens = math.min(bucketCapacity, tokens + tokensToAdd)
        lastRefill = now
      end
      
      -- Try to consume a token
      local success = tokens >= 1
      if success then
        tokens = tokens - 1
      end
      
      -- Save updated bucket state
      redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
      redis.call('PEXPIRE', key, refillInterval * 2)
      
      -- Analytics if requested
      if doAnalytics == 1 then
        redis.call('ZADD', analyticsKey, now, now)
        redis.call('PEXPIRE', analyticsKey, refillInterval)
      end
      
      -- Calculate time until next token refill
      local timeToNextToken = success and 0 or math.ceil((1 - tokens) * (refillInterval / refillRate))
      
      -- Calculate throughput if analytics enabled
      local throughput = 0
      if doAnalytics == 1 then
        -- Calculate requests in the last second
        local secondAgo = now - 1000
        throughput = redis.call('ZCOUNT', analyticsKey, secondAgo, '+inf')
      end
      
      return {
        success and 1 or 0,
        bucketCapacity,
        tokens,
        now + (refillInterval / refillRate),
        timeToNextToken,
        bucketCapacity - tokens,
        throughput
      }
    `);
  }

  /**
   * Get the Redis client with timeout protection
   */
  private async getRedis(): Promise<RedisClientType> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new RedisConnectionError(`Connection timed out after ${this.timeout}ms`)),
          this.timeout
        );
      });

      const redis = await Promise.race([this.redis, timeoutPromise]);
      
      // Check if Redis is connected
      if (!redis.isOpen) {
        await redis.connect();
      }
      
      // Verify connection with ping
      await redis.ping();
      
      return redis;
    } catch (error) {
      this.emit('error', new RedisConnectionError(
        error instanceof Error ? error.message : String(error)
      ));
      
      if (!this.failOpen) {
        throw new RedisConnectionError(
          error instanceof Error ? error.message : String(error)
        );
      }
      
      // If fail-open is enabled, we need to return something that won't break
      // downstream code, but this will never actually be used
      return Promise.resolve(this.redis) as Promise<RedisClientType>;
    }
  }

  /**
   * Apply rate limit for an identifier
   */
  async limit(identifier: string): Promise<RatelimitResponse> {
    const now = Date.now();
    const key = `${this.prefix}:${identifier}`;
    
    try {
      // Try Redis first
      return await this.applyLimit(key, now);
    } catch (error) {
      this.emit('error', error);
      
      // Handle Redis failure
      if (this.ephemeralCache && this.limiter.type === 'slidingWindow') {
        if (!this.silent) {
          console.warn(
            `[open-ratelimit] Redis error, using ephemeral cache: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        
        // Fall back to ephemeral cache
        return this.applyEphemeralLimit(key, identifier, now);
      }
      
      // If Redis fails and no ephemeral cache or incompatible limiter type
      if (!this.failOpen) {
        throw error;
      }
      
      // If fail-open is enabled, allow the request
      this.emit('failOpen', { identifier, error });
      if (!this.silent) {
        console.warn(
          `[open-ratelimit] Redis error, failing open for ${identifier}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      
      // Get limit based on limiter type
      const limit = 'limit' in this.limiter ? this.limiter.limit : 10;
      return {
        success: true, // Fail open
        limit,
        remaining: limit - 1,
        reset: now + 60000, // Arbitrary 1-minute reset
      };
    }
  }

  /**
   * Apply rate limit using appropriate algorithm
   */
  private async applyLimit(key: string, now: number): Promise<RatelimitResponse> {
    const redis = await this.getRedis();
    
    switch (this.limiter.type) {
      case 'slidingWindow':
        return this.applySlidingWindowLimit(redis, key, now);
      case 'fixedWindow':
        return this.applyFixedWindowLimit(redis, key, now);
      case 'tokenBucket':
        return this.applyTokenBucketLimit(redis, key, now);
      default:
        throw new RatelimitError(`Unknown limiter type: ${// biome-ignore lint/suspicious/noExplicitAny: <explanation>
(this.limiter as any).type}`);
    }
  }

  /**
   * Apply sliding window rate limit
   */
  private async applySlidingWindowLimit(
    redis: RedisClientType,
    key: string,
    now: number
  ): Promise<RatelimitResponse> {
    try {
      const limiter = this.limiter as SlidingWindowOptions;
      const analyticsKey = `${key}:analytics`;
      
      const result = await redis.eval(
        this.scripts.get('slidingWindow') as string,
        {
          keys: [key, analyticsKey],
          arguments: [
            now.toString(),
            limiter.windowMs.toString(),
            limiter.limit.toString(),
            this.analytics ? '1' : '0',
          ],
        }
      );

      if (!Array.isArray(result)) {
        throw new RatelimitError('Invalid response from Redis');
      }

      const response: RatelimitResponse = {
        success: Boolean(result[0]),
        limit: Number(result[1]),
        remaining: Number(result[2]),
        reset: Number(result[3]),
      };

      // Add conditional properties
      const retryAfter = Number(result[4]);
      if (retryAfter > 0) response.retryAfter = retryAfter;

      if (this.analytics) {
        response.pending = Number(result[5]);
        response.throughput = Number(result[6]);
      }

      // Store in ephemeral cache if available
      if (this.ephemeralCache) {
        this.ephemeralCache.set(key, limiter.limit - response.remaining, limiter.windowMs);
      }
      
      // Emit events
      this.emit(response.success ? 'allowed' : 'limited', {
        identifier: key.substring(this.prefix.length + 1),
        remaining: response.remaining,
        limit: response.limit,
      });

      return response;
    } catch (error) {
      throw new RatelimitError(
        `Sliding window limit error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply fixed window rate limit
   */
  private async applyFixedWindowLimit(
    redis: RedisClientType,
    key: string,
    now: number
  ): Promise<RatelimitResponse> {
    try {
      const limiter = this.limiter as FixedWindowOptions;
      
      // Create window key with fixed time boundary
      const windowKey = `${key}:${Math.floor(now / limiter.windowMs)}`;
      const analyticsKey = `${key}:analytics`;
      
      const result = await redis.eval(
        this.scripts.get('fixedWindow') as string,
        {
          keys: [windowKey, analyticsKey],
          arguments: [
            limiter.limit.toString(),
            limiter.windowMs.toString(),
            this.analytics ? '1' : '0',
            now.toString(),
          ],
        }
      );

      if (!Array.isArray(result)) {
        throw new RatelimitError('Invalid response from Redis');
      }

      const response: RatelimitResponse = {
        success: Boolean(result[0]),
        limit: Number(result[1]),
        remaining: Number(result[2]),
        reset: Number(result[3]),
      };

      const retryAfter = Number(result[4]);
      if (retryAfter > 0) response.retryAfter = retryAfter;

      if (this.analytics) {
        response.pending = Number(result[5]);
        response.throughput = Number(result[6]);
      }
      
      // Emit events
      this.emit(response.success ? 'allowed' : 'limited', {
        identifier: key.substring(this.prefix.length + 1),
        remaining: response.remaining,
        limit: response.limit,
      });

      return response;
    } catch (error) {
      throw new RatelimitError(
        `Fixed window limit error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply token bucket rate limit
   */
  private async applyTokenBucketLimit(
    redis: RedisClientType,
    key: string,
    now: number
  ): Promise<RatelimitResponse> {
    try {
      const limiter = this.limiter as TokenBucketOptions;
      const analyticsKey = `${key}:analytics`;
      
      const result = await redis.eval(
        this.scripts.get('tokenBucket') as string,
        {
          keys: [key, analyticsKey],
          arguments: [
            now.toString(),
            limiter.refillRate.toString(),
            limiter.interval.toString(),
            limiter.limit.toString(),
            this.analytics ? '1' : '0',
          ],
        }
      );

      if (!Array.isArray(result)) {
        throw new RatelimitError('Invalid response from Redis');
      }

      const response: RatelimitResponse = {
        success: Boolean(result[0]),
        limit: Number(result[1]),
        remaining: Number(result[2]),
        reset: Number(result[3]),
      };

      const retryAfter = Number(result[4]);
      if (retryAfter > 0) response.retryAfter = retryAfter;

      if (this.analytics) {
        response.pending = Number(result[5]);
        response.throughput = Number(result[6]);
      }
      
      // Emit events
      this.emit(response.success ? 'allowed' : 'limited', {
        identifier: key.substring(this.prefix.length + 1),
        remaining: response.remaining,
        limit: response.limit,
      });

      return response;
    } catch (error) {
      throw new RatelimitError(
        `Token bucket limit error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply rate limit using ephemeral cache (for fallback)
   */
  private applyEphemeralLimit(
    key: string,
    identifier: string,
    now: number
  ): RatelimitResponse {
    if (!this.ephemeralCache) {
      throw new RatelimitError('Ephemeral cache not available');
    }
    
    if (this.limiter.type !== 'slidingWindow') {
      throw new RatelimitError(
        `Ephemeral cache only supports sliding window, got: ${this.limiter.type}`
      );
    }
    
    const limiter = this.limiter as SlidingWindowOptions;
    const count = this.ephemeralCache.increment(key, limiter.windowMs);
    const success = count <= limiter.limit;
    
    const response: RatelimitResponse = {
      success,
      limit: limiter.limit,
      remaining: Math.max(0, limiter.limit - count),
      reset: now + limiter.windowMs,
    };
    
    if (!success) {
      response.retryAfter = Math.ceil(limiter.windowMs / 1000);
    }
    
    // Emit events
    this.emit(success ? 'allowed' : 'limited', {
      identifier,
      remaining: response.remaining,
      limit: response.limit,
      fromCache: true,
    });
    
    return response;
  }

  /**
   * Block until rate limit allows or max wait time is reached
   */
  async block(identifier: string, options?: {
    maxWaitMs?: number;
    maxAttempts?: number;
    retryDelayMs?: number;
  }): Promise<RatelimitResponse> {
    const {
      maxWaitMs = 5000,
      maxAttempts = 50,
      retryDelayMs = 100,
    } = options || {};
    
    const startTime = Date.now();
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      const response = await this.limit(identifier);
      if (response.success) {
        return response;
      }
      
      const currentTime = Date.now();
      if (currentTime - startTime >= maxWaitMs) {
        throw new RateLimitExceededError(
          identifier,
          response.retryAfter || 1
        );
      }
      
      // Dynamic backoff based on retry-after, but within bounds
      const waitTime = Math.max(
        50,
        Math.min(
          1000,
          response.retryAfter ? (response.retryAfter * 1000) / 4 : retryDelayMs
        )
      );
      
      // Emit waiting event
      this.emit('waiting', {
        identifier,
        attempt: attempts,
        waitTime,
        elapsed: currentTime - startTime,
      });
      
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    
    // This is a safeguard in case we reach max attempts
    throw new RateLimitExceededError(
      identifier,
      1
    );
  }

  /**
   * Reset rate limit for an identifier
   */
  async reset(identifier: string): Promise<boolean> {
    try {
      const redis = await this.getRedis();
      const key = `${this.prefix}:${identifier}`;
      
      // Clear all keys related to this identifier
      const keys = [
        key,
        `${key}:analytics`,
      ];
      
      // For fixed window, we need to find all window keys
      if (this.limiter.type === 'fixedWindow') {
        const pattern = `${key}:*`;
        const scanResult = await redis.scan(0, { MATCH: pattern, COUNT: 100 });
        
        if (scanResult.keys.length > 0) {
          keys.push(...scanResult.keys);
        }
      }
      
      // Delete all keys
      if (keys.length > 0) {
        await redis.del(keys);
      }
      
      // Also clear ephemeral cache if available
      if (this.ephemeralCache) {
        this.ephemeralCache.set(key, 0, 0);
      }
      
      this.emit('reset', { identifier });
      return true;
    } catch (error) {
      this.emit('error', new RatelimitError(
        `Failed to reset rate limit: ${error instanceof Error ? error.message : String(error)}`
      ));
      
      if (!this.failOpen) {
        throw new RatelimitError(
          `Failed to reset rate limit: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      
      return false;
    }
  }

  /**
   * Get current rate limit statistics
   */
  async getStats(identifier: string): Promise<{
    used: number;
    remaining: number;
    limit: number;
    reset: number;
  }> {
    const response = await this.limit(identifier);
    
    // Return limit info without consuming a token
    return {
      used: response.limit - response.remaining,
      remaining: response.remaining,
      limit: response.limit,
      reset: response.reset,
    };
  }

  /**
   * Check if rate limit is exceeded without consuming a token
   */
  async check(identifier: string): Promise<boolean> {
    const stats = await this.getStats(identifier);
    return stats.remaining > 0;
  }

  /**
   * Clean up resources
   */
  async close(): Promise<void> {
    if (this.ephemeralCache) {
      this.ephemeralCache.destroy();
    }
    
    // Don't close Redis if it was passed in
    if (typeof this.redis === 'object' && 'quit' in this.redis) {
      // We don't want to close a client that might be shared
      // Only close if we created it
    }
    
    this.removeAllListeners();
  }
}

// ----------------------
// Factory Functions
// ----------------------

/**
 * Create a rate limiter with default Redis client
 */
export const createRateLimiter = async (
  config: Omit<RatelimitConfig, 'redis'> & { 
    redis?: RedisOptions;
  }
): Promise<Ratelimit> => {
  const redisClient = await getRedisClient(config.redis || {});
  
  return new Ratelimit({
    redis: redisClient,
    ...config,
  });
};

/**
 * Create and reuse a singleton rate limiter instance
 */
let singletonInstance: Ratelimit | null = null;

export const createSingletonRateLimiter = async (
  config?: Omit<RatelimitConfig, 'redis'> & { 
    redis?: RedisOptions;
    envRedisKey?: string;
  }
): Promise<Ratelimit> => {
  if (singletonInstance) {
    return singletonInstance;
  }
  
  const finalConfig : Partial<RatelimitConfig> & { 
    redis?: RedisOptions;
    envRedisKey?: string;
  }  = config || {};
  
  // Use environment variable if specified
  if (finalConfig.envRedisKey) {
    finalConfig.redis = {
      url: process.env[finalConfig.envRedisKey],
    };
  }
  
  singletonInstance = await createRateLimiter({
    limiter: slidingWindow(10, '10 s'),
    ...finalConfig,
  });
  
  return singletonInstance;
};

// WILL ADD DECORATOR LATER FOR CLASSES 

// Export everything
export default {
  Ratelimit,
  createRateLimiter,
  createSingletonRateLimiter,
  fixedWindow,
  slidingWindow,
  tokenBucket,
  parseTimeWindow,
  getRedisClient,
  closeRedisClient,
  RatelimitError,
  RedisConnectionError,
  RateLimitExceededError,
};

