import { Ratelimit, fixedWindow, getRedisClient } from 'oss-ratelimit';
 
// 1. Prepare Redis Client (using environment variables is recommended)
// Option A: Use the library's helper (handles connection logic)
const redisClientPromise = getRedisClient({
  url: process.env.RATELIMIT_REDIS_URL || 'redis://localhost:6379',
});
 
// Option B: Provide your own connected client instance
// const myRedisClient = createClient({ url: process.env.RATELIMIT_REDIS_URL });
// await myRedisClient.connect();
 
 
// 2. Configure the Limiter Algorithm
const limiterAlgorithm = fixedWindow(
  10,     // Allow 10 requests...
  '15 s'  // ...per 15 seconds
);
 
// 3. Create the Ratelimit Instance
// We await the client promise here before creating the Ratelimit instance
let ratelimit: Ratelimit;
 
redisClientPromise.then(redisClient => {
  ratelimit = new Ratelimit({
    redis: redisClient,           // The connected Redis client
    limiter: limiterAlgorithm,    // The chosen algorithm configuration
    prefix: 'myapp_basic',        // Optional: Prefix for Redis keys
  });
  console.log("Rate limiter initialized successfully!");
}).catch(err => {
  console.error("Failed to initialize rate limiter:", err);
  // Handle initialization failure (e.g., exit process, disable features)
});
 
 
// Export the instance (or a function to get it) for use elsewhere
// Note: Accessing 'ratelimit' before the promise resolves will result in an error.
// Consider using the registry pattern for easier management (see below).
export const getBasicRatelimiter = async (): Promise<Ratelimit> => {
    await redisClientPromise; // Ensure connection before returning
    if (!ratelimit) throw new Error("Ratelimiter not initialized");
    return ratelimit;
}