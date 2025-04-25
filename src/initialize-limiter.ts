import { Ratelimit, RateLimitBuilder, RatelimitConfig, RedisOptions } from "../src/index";

// 2. Define the configuration type expected by the registry's register method
export type RegisterConfigParam = Omit<RatelimitConfig, 'redis'> & {
    redis?: RedisOptions;
    envRedisKey?: string;
};

/**
 * Options for the limiter initialization utility
 */
export interface InitLimitersOptions<TNames extends string> {
  /** Registry instance to use for limiter registration */
  registry: RateLimitBuilder<TNames>;
  
  /** Configuration for each limiter */
  configs: Record<TNames, RegisterConfigParam>;
  
  /** Callback fired when each limiter is registered */
  onRegister?: (name: TNames) => void;
  
  /** Callback fired when all limiters are initialized */
  onComplete?: () => void;
  
  /** Whether to throw on initialization errors (default: true) */
  throwOnError?: boolean;
  
  /** Whether to log progress (default: true) */
  verbose?: boolean;
}

/**
 * Registers and initializes multiple rate limiters from a configuration object
 * 
 * @param options Configuration options for initialization
 * @returns Promise that resolves to a record of initialized limiters
 * @throws If any limiter fails to initialize and throwOnError is true
 * 
 * @example
 * ```typescript
 * // Initialize all limiters at once
 * const limiters = await initializeLimiters({
 *   registry: rl,
 *   configs: limiterConfigs
 * });
 * 
 * // Use specific limiters
 * const apiLimiter = limiters.apiPublic;
 * ```
 */
export async function initializeLimiters<TNames extends string>(
  options: InitLimitersOptions<TNames>
): Promise<Record<TNames, Ratelimit>> {
  const {
    registry,
    configs,
    onRegister,
    onComplete,
    throwOnError = true,
    verbose = true
  } = options;
  
  if (verbose) console.log('Initializing rate limiters...');
  
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
const  registrationPromises: Array<Promise<{ name: TNames; limiter?: Ratelimit; error?: any }>> = [];
  const results: Partial<Record<TNames, Ratelimit>> = {};

  // Iterate through the config and register each limiter
  for (const name in configs) {
    if (Object.prototype.hasOwnProperty.call(configs, name)) {
      const limiterName = name as TNames;
      if (verbose) console.log(`- Registering: ${String(limiterName)}`);
      
      const promise = registry.register(limiterName, configs[limiterName])
        .then(limiter => {
          if (onRegister) onRegister(limiterName);
          return { name: limiterName, limiter };
        })
        .catch(error => {
          console.error(`Failed to initialize limiter "${String(limiterName)}":`, error);
          if (throwOnError) throw error;
          return { name: limiterName, error };
        });
        
      registrationPromises.push(promise);
    }
  }

  // Wait for all limiters to initialize
  const settled = await Promise.allSettled(registrationPromises);
  
  // Process results
  for (const result of settled) {
    if (result.status === 'fulfilled' && !('error' in result.value)) {
      results[result.value.name] = result.value.limiter;
    }
  }
  
  if (verbose) console.log('✅ All limiters initialized.');
  if (onComplete) onComplete();
  
  // Cast to non-partial record since we'll either have all entries or have thrown
  return results as Record<TNames, Ratelimit>;
}


/**
 * Type-safe accessor for limiters that ensures they are initialized
 * 
 * @param name Name of the limiter to retrieve
 * @param registry Registry instance containing the limiters
 * @returns The initialized limiter
 * @throws If the limiter is not found or not initialized
 * 
 * @example
 * ```typescript
 * // Get a specific limiter
 * const apiLimiter = getInitializedLimiter('apiPublic', rl);
 * ```
 */
export function getInitializedLimiter<TNames extends string>(
  name: TNames,
  registry: RateLimitBuilder<TNames>
): Ratelimit {
  try {
    return registry.get(name);
  } catch (error) {
    throw new Error(`Limiter "${String(name)}" not initialized. Did you call initializeLimiters?`);
  }
}

/**
 * Create a type-safe accessor function for a specific registry
 * 
 * @param registry Registry instance containing limiters
 * @returns A function that retrieves initialized limiters
 * 
 * @example
 * ```typescript
 * // Create a bound getter for your registry
 * const getLimiter = createLimiterAccessor(rl);
 * 
 * // Use it to get specific limiters
 * const apiLimiter = getLimiter('apiPublic');
 * ```
 */
export function createLimiterAccessor<TNames extends string>(
  registry: RateLimitBuilder<TNames>
): (name: TNames) => Ratelimit {
  return (name: TNames) => getInitializedLimiter(name, registry);
}