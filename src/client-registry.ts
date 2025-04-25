import { EventEmitter } from 'events';
import { RedisClientType } from 'redis';
import {
  Ratelimit,
  RatelimitConfig,
  RedisOptions,
  getRedisClient, // Factory function from the library
  slidingWindow, // Default limiter example
} from './index'; // Adjust import path if core types are elsewhere

/**
 * INTERNAL class managing rate limiter instances and their Redis clients.
 */
// Note: Still considering not exporting this if only init is the API
export class _InternalRateLimiterRegistry<TAllNames extends string> {
  // Made generic
  // Use the generic type for keys where appropriate
  private limiters: Partial<Record<TAllNames, Ratelimit | Promise<Ratelimit>>> = {};
  private redisClients: Record<string, Promise<RedisClientType>> = {};
  private registryEmitter = new EventEmitter();
  private defaultRedisOpts: RedisOptions;

  constructor(defaultRedisOptions: RedisOptions = {}) {
    this.defaultRedisOpts = defaultRedisOptions;
  }

  /**
   * Generates a unique key for a Redis configuration to enable client reuse.
   * Made public for use by the builder wrapper.
   */
  public getRedisClientKey(config?: {
    // Changed to public
    redis?: RedisOptions;
    envRedisKey?: string;
  }): string {
    const specificOptions = config?.redis || {};
    const specificEnvKey = config?.envRedisKey;
    const effectiveOptions = { ...this.defaultRedisOpts, ...specificOptions };
    const effectiveEnvKey = specificEnvKey;

    const envUrl = effectiveEnvKey ? process.env[effectiveEnvKey] : undefined;
    if (envUrl?.trim()) return `env:${envUrl.trim()}`;
    if (effectiveOptions.url?.trim()) return `opts_url:${effectiveOptions.url.trim()}`;
    try {
      const keyOptions = {
        host: effectiveOptions.host,
        port: effectiveOptions.port,
        database: effectiveOptions.database,
        username: effectiveOptions.username,
      };
      return `opts_obj:${JSON.stringify(keyOptions)}`;
    } catch (e) {
      return `opts_fallback:${Date.now()}_${Math.random()}`;
    }
  }

  // --- getManagedRedisClient remains private ---
  private getManagedRedisClient(config?: {
    redis?: RedisOptions;
    envRedisKey?: string;
  }): Promise<RedisClientType> {
    // Pass effective options when calling getRedisClientKey internally
    const effectiveOptions = { ...this.defaultRedisOpts, ...(config?.redis || {}) };
    const clientKey = this.getRedisClientKey({
      redis: effectiveOptions,
      envRedisKey: config?.envRedisKey,
    });

    if (!this.redisClients[clientKey]) {
      console.log(
        `[_InternalRateLimiterRegistry] Creating new Redis client promise for key: ${clientKey}`
      );
      let finalFactoryOptions: RedisOptions = {};
      const envUrl = config?.envRedisKey ? process.env[config.envRedisKey] : undefined;
      if (envUrl?.trim()) {
        finalFactoryOptions = { url: envUrl.trim() };
      } else {
        // Use the potentially merged options
        finalFactoryOptions = effectiveOptions;
      }
      this.redisClients[clientKey] = getRedisClient(finalFactoryOptions)
        .then((client) => {
          /* ...log, emit */ return client;
        })
        .catch((err) => {
          /* ...log, delete, emit */ throw err;
        });
    }
    return this.redisClients[clientKey];
  }

  // Use the generic TAllNames for the name parameter type
  public register(
    // Removed <T extends string> here
    name: TAllNames, // Use the instance-level generic type
    config?: Omit<RatelimitConfig, 'redis'> & {
      redis?: RedisOptions;
      envRedisKey?: string;
    }
  ): Promise<Ratelimit> {
    if (typeof name !== 'string' || !name.trim()) {
      // Keep runtime check
      return Promise.reject(
        new Error('[_InternalRateLimiterRegistry] Registration name must be a non-empty string.')
      );
    }
    // No need for trimmedName if using TAllNames directly as key type
    if (this.limiters[name]) {
      return Promise.resolve(this.limiters[name] as Ratelimit | Promise<Ratelimit>); // Type assertion needed
    }
    console.log(`[_InternalRateLimiterRegistry] Initializing limiter: "${String(name)}"`); // Coerce to string for logging

    const limiterOrDefault = config?.limiter || slidingWindow(10, '10 s');
    const effectiveRegisterConfig = { limiter: limiterOrDefault, ...config };

    const initializationPromise = (async (): Promise<Ratelimit> => {
      try {
        const redisClient = await this.getManagedRedisClient({
          redis: effectiveRegisterConfig.redis,
          envRedisKey: effectiveRegisterConfig.envRedisKey,
        });
        const finalRatelimitConfig: RatelimitConfig = {
          redis: redisClient,
          limiter: effectiveRegisterConfig.limiter,
          prefix: effectiveRegisterConfig.prefix,
          analytics: effectiveRegisterConfig.analytics,
          timeout: effectiveRegisterConfig.timeout,
          ephemeralCache: effectiveRegisterConfig.ephemeralCache,
          ephemeralCacheTTL: effectiveRegisterConfig.ephemeralCacheTTL,
          failOpen: effectiveRegisterConfig.failOpen,
          silent: effectiveRegisterConfig.silent,
        };
        const instance = new Ratelimit(finalRatelimitConfig);
        const clientKey = this.getRedisClientKey(effectiveRegisterConfig); // Use public method
        console.log(
          `[_InternalRateLimiterRegistry] Registered limiter "${String(
            name
          )}" using Redis client key: ${clientKey}`
        );
        this.registryEmitter.emit('limiterRegister', { name: name, clientKey });
        this.limiters[name] = instance;
        return instance;
      } catch (error) {
        console.error(
          `[_InternalRateLimiterRegistry] Failed to initialize limiter "${String(name)}":`,
          error
        );
        delete this.limiters[name];
        this.registryEmitter.emit('limiterError', { name: name, error });
        throw error;
      }
    })();
    this.limiters[name] = initializationPromise;
    return initializationPromise;
  }

  // Use the generic TAllNames for the name parameter type
  public get(name: TAllNames): Ratelimit {
    // Removed <T extends string>
    const instance = this.limiters[name];
    if (!instance) {
      throw new Error(`[_InternalRateLimiterRegistry] Limiter "${String(name)}" not found.`);
    }
    if (instance instanceof Promise) {
      throw new Error(
        `[_InternalRateLimiterRegistry] Limiter "${String(name)}" still initializing.`
      );
    }
    return instance as Ratelimit; // Type assertion
  }

  // isInitialized still takes string as it might be called with arbitrary values
  public isInitialized(name: string): boolean {
    const instance = this.limiters[name as TAllNames]; // Cast needed for lookup
    return !!instance && !(instance instanceof Promise);
  }

  public async close(): Promise<void> {
    // ... (close logic remains the same, using client.quit()) ...
    const clientKeys = Object.keys(this.redisClients);
    console.log(
      `[_InternalRateLimiterRegistry] Closing ${clientKeys.length} managed Redis client(s)...`
    );
    const quitPromises: Promise<void>[] = [];
    for (const key of clientKeys) {
      const clientPromise = this.redisClients[key];
      const quitPromise = clientPromise
        .then((client) =>
          client && typeof client.quit === 'function'
            ? client.quit().then(() => {
                // not returning client
              })
            : Promise.resolve()
        )
        .catch((err) => {
          console.error(`Error quitting client ${key}:`, err);
          return Promise.resolve();
        });
      quitPromises.push(quitPromise);
    }
    await Promise.allSettled(quitPromises);
    this.redisClients = {};
    this.limiters = {};
    this.registryEmitter.emit('close');
    console.log('[_InternalRateLimiterRegistry] Registry cleared.');
  }

  public getClientPromiseForKey(key: string): Promise<RedisClientType> | undefined {
    return this.redisClients[key];
  }

  // Event listeners remain the same
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  public on(eventName: string, listener: (...args: any[]) => void): this {
    this.registryEmitter.on(eventName, listener);
    return this;
  }
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  public off(eventName: string, listener: (...args: any[]) => void): this {
    this.registryEmitter.off(eventName, listener);
    return this;
  }
}

// --- Builder Function ---

type RegisterConfigParam = Omit<RatelimitConfig, 'redis'> & {
  redis?: RedisOptions;
  envRedisKey?: string;
};

// Define the interface for the returned builder object, now generic over names
export interface RateLimitBuilder<TNames extends string> {
  // Made generic
  /** Registers or retrieves a rate limiter instance with the given name and config */
  register: (name: TNames, config?: RegisterConfigParam) => Promise<Ratelimit>; // Uses TNames
  /** Synchronously gets an initialized rate limiter instance by name */
  get: (name: TNames) => Ratelimit; // Uses TNames
  /** Checks if a limiter instance is registered and initialized */
  isInitialized: (name: TNames | string) => boolean; // Can check specific or any string
  /** Closes all Redis clients managed by this registry instance */
  close: () => Promise<void>;
  /** Allows listening to registry events */
  on: (
    eventName: 'redisConnect' | 'redisError' | 'limiterRegister' | 'limiterError' | 'close',
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
listener: (...args: any[]) => void
  ) => RateLimitBuilder<TNames>; // Returns typed builder
  /** Allows removing registry event listeners */
  off: (
    eventName: 'redisConnect' | 'redisError' | 'limiterRegister' | 'limiterError' | 'close',
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
listener: (...args: any[]) => void
  ) => RateLimitBuilder<TNames>; // Returns typed builder
  /** Attempts to get the managed Redis client promise based on configuration key */
  getClient: (config: { redis?: RedisOptions; envRedisKey?: string }) =>
    | Promise<RedisClientType>
    | undefined;
}

/**
 * Initializes a rate limiter registry instance and returns a typed builder API.
 * @param options Configuration options for the registry instance.
 * @param options.defaultRedisOptions Default Redis connection options.
 * @typeparam TNames A string literal type union representing the valid names for limiters in this registry instance (e.g., 'api' | 'webhooks'). Defaults to `string`.
 */
// Make initRateLimit generic, defaulting TNames to string if not provided
export function initRateLimit<TNames extends string = string>(options?: {
  defaultRedisOptions?: RedisOptions;
}): RateLimitBuilder<TNames> {
  // Pass TNames generic type to the internal registry
  const registry = new _InternalRateLimiterRegistry<TNames>(options?.defaultRedisOptions);

  // Explicitly define the builder object to be returned *before* defining methods
  // that reference it (like on/off needing to return `builder`).
  const builder: RateLimitBuilder<TNames> = {
    // Bind methods to the specific registry instance created
    register: registry.register.bind(registry),
    get: registry.get.bind(registry),
    isInitialized: registry.isInitialized.bind(registry),
    close: registry.close.bind(registry),
    on: (eventName, listener) => {
      registry.on(eventName, listener);
      // Return the captured builder object, not 'this'
      return builder;
    },
    off: (eventName, listener) => {
      registry.off(eventName, listener);
      // Return the captured builder object, not 'this'
      return builder;
    },
    getClient: (config) => {
      // Access the now public method on the registry instance
      const key = registry.getRedisClientKey(config);
      return registry.getClientPromiseForKey(key);
    },
  };

  return builder; // Return the fully constructed builder object
}
