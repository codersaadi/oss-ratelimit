import { RatelimitConfig, RedisOptions, slidingWindow, fixedWindow } from "../src/index"; // Use types from library

// 1. Define the names for all limiters in the application
export type AppLimiterName = 'apiPublic' | 'apiAuthenticated' | 'webhookGithub' | 'adminOps';

// 2. Define the configuration type expected by the registry's register method
export type RegisterConfigParam = Omit<RatelimitConfig, 'redis'> & {
    redis?: RedisOptions;
    envRedisKey?: string;
};

// 3. Centralized configuration object
export const limiterConfigs: Record<AppLimiterName, RegisterConfigParam> = {
    apiPublic: {
        limiter: slidingWindow(20, '1 m'), // Stricter: 20 requests/minute
        prefix: 'rl_api_pub', // Use distinct prefixes
    },
    apiAuthenticated: {
        limiter: fixedWindow(200, '1 h'), // More lenient: 200 requests/hour
        prefix: 'rl_api_auth',
        analytics: true, // Enable analytics
    },
    webhookGithub: {
        limiter: slidingWindow(100, '5 m'), // Allow bursts: 100 requests/5 minutes
        prefix: 'rl_hook_gh',
        // Specify connection via environment variable name (defined in .env)
        envRedisKey: 'SECONDARY_REDIS_URL',
        timeout: 500, // Custom timeout for Redis operations
    },
    adminOps: {
        limiter: fixedWindow(10, '1 h'), // Very strict: 10 requests/hour
        prefix: 'rl_admin',
        // Specify connection via direct options (overrides defaultRedisOptions from init)
        redis: {
            database: 2, // Use database 2 on the default Redis connection
        },
    },
};