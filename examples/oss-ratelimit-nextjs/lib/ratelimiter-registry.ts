import { initRateLimit, slidingWindow, initializeLimiters, Ratelimit,  } from 'oss-ratelimit';
// Define your limiter names
export type NextAppLimiter = 'api' | 'auth' | 'publicPages' | 'webhooks';

// Create and export the registry
export const rl = initRateLimit<NextAppLimiter>({
  defaultRedisOptions: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  }
});

// Define configurations
export const limiterConfigs = {
  api: {
    limiter: slidingWindow(50, '1 m'),
    prefix: 'next_api',
  },
  auth: {
    limiter: slidingWindow(5, '5 m'),
    prefix: 'next_auth',
  },
  publicPages: {
    limiter: slidingWindow(100, '1 m'),
    prefix: 'next_public',
  },
  webhooks: {
    limiter: slidingWindow(20, '1 m'),
    prefix: 'next_hooks',
  }
};

// Create and export an accessor function
export const getLimiter = (name: NextAppLimiter) => rl.get(name);

// Initialize all limiters on import
let initLimtersPromise: Promise<Record<NextAppLimiter, Ratelimit>> | null= null;

export function ensureLimitersInitialized() {
  if (!initLimtersPromise) {
    initLimtersPromise  = initializeLimiters({
      registry: rl,
      configs: limiterConfigs,
      verbose: process.env.NODE_ENV !== 'production'
    })
  }
  return initLimtersPromise;
}

import { closeRedisClient } from 'oss-ratelimit'; // If using standalone client
 
async function shutdown() {
  console.log("Shutting down...");
 
  // Close clients managed by the registry
  await rl.close();
  console.log("Rate limiter registry closed.");
  // If you created standalone clients with getRedisClient, close them too
  // await closeRedisClient(); // This closes the *last* client created by getRedisClient
 
  process.exit(0);
}
 
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);