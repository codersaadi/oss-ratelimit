// import * as dotenv from 'dotenv';
// dotenv.config(); // Load .env file variables

import { initRateLimit, Ratelimit,  } from '../src/index'; // Import the builder init function
import { initializeLimiters } from '../src/initialize-limiter';
import { limiterConfigs, AppLimiterName } from './config'; // Import names and configs

// Initialize the rate limiter builder ONCE for the application
// Pass the generic type for application-wide type safety
// {
//     // Optional: Define default Redis options used if a limiter config doesn't specify any
//     // defaultRedisOptions: {
        
//     //     // url: process.env.REDIS_URL // This is often handled by the lib's getRedisClient default
//     // }
// }
const rl = initRateLimit<AppLimiterName>();
// Listen to events from the registry (optional)


rl.on('redisConnect', ({ key }) => console.log(`EVENT: Redis client connected (key: ${key})`))
  .on('limiterRegister', ({ name, clientKey }) => console.log(`EVENT: Limiter "${name}" registered (client key: ${clientKey})`))
  .on('redisError', ({ key, error }) => console.error(`EVENT: Redis Error (key: ${key})`, error));



async function runExampleChecks() {
    console.log('\nRunning example checks...');

    // --- Public API Check ---
    const publicLimiter = rl.get('apiPublic'); // Type safe!
    const ip = '192.168.1.100';
    let res = await publicLimiter.limit(ip);
    console.log(`Public API check for ${ip}: Success=${res.success}, Remaining=${res.remaining}`);

    // --- Authenticated API Check ---
    try {
        const authLimiter = rl.get('apiAuthenticated');
        const userId = 'user-abc-123';
        res = await authLimiter.limit(userId);
        console.log(`Auth API check for ${userId}: Success=${res.success}, Remaining=${res.remaining}`);
    } catch (error) {
        console.error("Error getting/using auth limiter:", error)
    }


    // --- Webhook Check (potentially different Redis) ---
     try {
        const webhookLimiter = rl.get('webhookGithub');
        const repo = 'org/repo-name';
        res = await webhookLimiter.limit(repo);
        console.log(`Webhook check for ${repo}: Success=${res.success}, Remaining=${res.remaining}`);
    } catch (error) {
        console.error("Error getting/using webhook limiter:", error)
    }

     // --- Admin Check (potentially different DB) ---
     try {
        const adminLimiter = rl.get('adminOps');
        const adminAction = 'delete-user';
        res = await adminLimiter.limit(adminAction);
        console.log(`Admin check for ${adminAction}: Success=${res.success}, Remaining=${res.remaining}`);
    } catch (error) {
        console.error("Error getting/using admin limiter:", error)
    }

    // --- Get non-existent limiter (will throw error) ---
    try {
         // @ts-expect-error - Intentionally checking for a non-existent key (TS should catch this if strict)
         const nonExistent = rl.get('doesNotExist');
         console.log('Non-existent limiter check (SHOULD NOT REACH HERE)');
    } catch (error: any) {
        console.log(`Expected error getting non-existent limiter: ${error.message}`);
    }
}

async function main() {
    const limiters = await initializeLimiters({
        registry: rl,
        configs: limiterConfigs,
        onRegister: (name: any) => console.log(`Limiter "${name}" registered`),
        verbose: true
      });
      
    await runExampleChecks();

    // Clean up connections when done
    console.log('\nClosing registry clients...');
    await rl.close();
    console.log('Finished.');
}

main().catch(err => {
    console.error("Unhandled error in main:", err);
    process.exit(1);
});