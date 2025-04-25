import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Ratelimit, slidingWindow } from "../src/index";
import { RateLimitBuilder } from "../src";
import { 
  initializeLimiters, 
  getInitializedLimiter, 
  createLimiterAccessor 
} from "../src";
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
type  AnyType = any
// Mock the rate limiter registry
vi.mock("../src/registry", () => {
  const mockRegister = vi.fn();
  const mockGet = vi.fn();
  const mockIsInitialized = vi.fn();
  const mockClose = vi.fn();
  
  return {
    initRateLimit: vi.fn().mockImplementation(() => ({
      register: mockRegister,
      get: mockGet,
      isInitialized: mockIsInitialized,
      close: mockClose,
      on: vi.fn(),
      off: vi.fn()
    }))
  };
});

describe("Rate Limiter Utils", () => {
  type TestLimiters = "api" | "auth" | "admin";
  
  let mockRegistry: RateLimitBuilder<TestLimiters>;
  let mockConfigs: Record<TestLimiters, AnyType>;
  let mockLimiters: Record<string, Ratelimit>;
  
  beforeEach(() => {
    // Create mock registry
    mockRegistry = {
      register: vi.fn(),
      get: vi.fn(),
      isInitialized: vi.fn().mockReturnValue(true),
      close: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      
      getClient: vi.fn()
    };
    
    // Create mock limiters
    mockLimiters = {
      api: { limit: vi.fn() } as unknown as Ratelimit,
      auth: { limit: vi.fn() } as unknown as Ratelimit,
      admin: { limit: vi.fn() } as unknown as Ratelimit
    };
    
    // Mock register to return the corresponding limiter
    (mockRegistry.register as AnyType).mockImplementation((name: string) => {
      return Promise.resolve(mockLimiters[name]);
    });
    
    // Mock get to return the corresponding limiter
    (mockRegistry.get as AnyType).mockImplementation((name: string) => {
      return mockLimiters[name];
    });
    
    // Create mock configs
    mockConfigs = {
      api: { limiter: slidingWindow(10, "10 s") },
      auth: { limiter: slidingWindow(20, "1 m") },
      admin: { limiter: slidingWindow(5, "1 h") }
    };
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe("initializeLimiters", () => {
    it("should initialize all limiters from config", async () => {
      const result = await initializeLimiters({
        registry: mockRegistry,
        configs: mockConfigs
      });
      
      // Should have called register for each config
      expect(mockRegistry.register).toHaveBeenCalledTimes(3);
      expect(mockRegistry.register).toHaveBeenCalledWith("api", mockConfigs.api);
      expect(mockRegistry.register).toHaveBeenCalledWith("auth", mockConfigs.auth);
      expect(mockRegistry.register).toHaveBeenCalledWith("admin", mockConfigs.admin);
      
      // Should return all limiters
      expect(result).toEqual({
        api: mockLimiters.api,
        auth: mockLimiters.auth,
        admin: mockLimiters.admin
      });
    });
    
    it("should call onRegister for each limiter", async () => {
      const onRegister = vi.fn();
      
      await initializeLimiters({
        registry: mockRegistry,
        configs: mockConfigs,
        onRegister
      });
      
      expect(onRegister).toHaveBeenCalledTimes(3);
      expect(onRegister).toHaveBeenCalledWith("api");
      expect(onRegister).toHaveBeenCalledWith("auth");
      expect(onRegister).toHaveBeenCalledWith("admin");
    });
    
    it("should call onComplete when all limiters are initialized", async () => {
      const onComplete = vi.fn();
      
      await initializeLimiters({
        registry: mockRegistry,
        configs: mockConfigs,
        onComplete
      });
      
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    
    // it("should throw if any limiter fails to initialize", async () => {
    //   // Make one limiter fail
    //   (mockRegistry.register as AnyType).mockImplementationOnce(() => {
    //     return Promise.reject(new Error("Failed to initialize"));
    //   });

      
    //   await expect(
    //     initializeLimiters({
    //       registry: mockRegistry,
    //       configs: mockConfigs,
    //       throwOnError: true
    //     })
    //   ).rejects.toThrow("Failed to initialize");
    // });
    
    it("should not throw if throwOnError is false", async () => {
      // Make one limiter fail
      (mockRegistry.register as AnyType).mockImplementationOnce(() => {
        return Promise.reject(new Error("Failed to initialize"));
      });
      
      const result = await initializeLimiters({
        registry: mockRegistry,
        configs: mockConfigs,
        throwOnError: false
      });
      
      // Should still return successful limiters
      expect(result).toHaveProperty("auth");
      expect(result).toHaveProperty("admin");
      expect(result).not.toHaveProperty("api");
    });
    
    it("should not log if verbose is false", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      
      await initializeLimiters({
        registry: mockRegistry,
        configs: mockConfigs,
        verbose: false
      });
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
  
  describe("getInitializedLimiter", () => {
    it("should return the limiter if initialized", () => {
      const limiter = getInitializedLimiter("api", mockRegistry);
      
      expect(mockRegistry.get).toHaveBeenCalledWith("api");
      expect(limiter).toBe(mockLimiters.api);
    });
    
    it("should throw if the limiter is not initialized", () => {
      // Mock get to throw
      (mockRegistry.get as AnyType).mockImplementationOnce(() => {
        throw new Error("Not initialized");
      });
      
      expect(() => getInitializedLimiter("api", mockRegistry)).toThrow();
    });
  });
  
  describe("createLimiterAccessor", () => {
    it("should create an accessor function", () => {
      const getLimiter = createLimiterAccessor(mockRegistry);
      
      expect(getLimiter).toBeInstanceOf(Function);
      
      const limiter = getLimiter("api");
      
      expect(mockRegistry.get).toHaveBeenCalledWith("api");
      expect(limiter).toBe(mockLimiters.api);
    });
    
    it("should throw if the limiter is not initialized", () => {
      const getLimiter = createLimiterAccessor(mockRegistry);
      
      // Mock get to throw
      (mockRegistry.get as AnyType).mockImplementationOnce(() => {
        throw new Error("Not initialized");
      });
      
      expect(() => getLimiter("api")).toThrow();
    });
  });
  
  describe("Integration with multiple limiters", () => {
    it("should support multiple limiters with different configs", async () => {
      // Mock different Redis URLs
      const configs = {
        api: { 
          limiter: slidingWindow(10, "10 s"),
          redis: { url: "redis://localhost:6379" }
        },
        auth: { 
          limiter: slidingWindow(20, "1 m"),
          redis: { url: "redis://auth:6379" }
        },
        admin: { 
          limiter: slidingWindow(5, "1 h"),
          envRedisKey: "ADMIN_REDIS_URL"
        }
      };
      
      await initializeLimiters({
        registry: mockRegistry,
        configs
      });
      
      // Should have called register with the right configs
      expect(mockRegistry.register).toHaveBeenCalledWith("api", configs.api);
      expect(mockRegistry.register).toHaveBeenCalledWith("auth", configs.auth);
      expect(mockRegistry.register).toHaveBeenCalledWith("admin", configs.admin);
    });
  });
});