import { createClient, RedisClientType } from 'redis'; // Import RedisClientType if needed for casting
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Import RateLimitExceededError if you uncomment the block test
import { RatelimitError, RateLimitExceededError } from '../src';
import { Ratelimit, fixedWindow, slidingWindow, tokenBucket } from '../src/index';
import { TimeWindow } from '../src/index';
import { parseTimeWindow } from '../src/index';

// --- Mock Redis Client (Improved with scan) ---
type MockRedisClient = Partial<RedisClientType> & {
    isOpen: boolean;
    ping: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    eval: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>; // Added scan mock
    on: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>; // Added quit mock
};

const mockRedisClient: MockRedisClient = {
    isOpen: true,
    ping: vi.fn().mockResolvedValue('PONG'),
    connect: vi.fn().mockResolvedValue(undefined),
    // biome-ignore lint/suspicious/noExplicitAny: Mocking complex type
    eval: vi.fn() as any,
    del: vi.fn().mockResolvedValue(1), // Default mock for DEL
    scan: vi.fn().mockResolvedValue({ cursor: 0, keys: [] }), // Default mock for SCAN
    // biome-ignore lint/suspicious/noExplicitAny: Mocking complex type
    on: vi.fn() as any, // Mock 'on' for event listeners
    quit: vi.fn().mockResolvedValue('OK'),
};

vi.mock('redis', () => {
    return {
        createClient: vi.fn(() => mockRedisClient), // Return the mock instance
    };
});
// --- End Mock Redis Client ---


describe('parseTimeWindow', () => {
  it('should parse time windows correctly', () => {
    expect(parseTimeWindow('100 ms')).toBe(100);
    expect(parseTimeWindow('5 s')).toBe(5000);
    expect(parseTimeWindow('2 m')).toBe(120000);
    expect(parseTimeWindow('1 h')).toBe(3600000);
    expect(parseTimeWindow('1 d')).toBe(86400000);
  });

  it('should throw error for invalid time values', () => {
    expect(() => parseTimeWindow('0 s')).toThrow(RatelimitError);
    expect(() => parseTimeWindow('-5 s')).toThrow(RatelimitError);
    expect(() => parseTimeWindow('invalid s' as TimeWindow)).toThrow(RatelimitError);
  });

  it('should throw error for invalid time units', () => {
    const INVALID = '10 invalid' as TimeWindow;
    expect(() => parseTimeWindow(INVALID)).toThrow(RatelimitError);
  });
});

describe('Limiter configuration functions', () => {
  it('should create fixed window options', () => {
    const options = fixedWindow(100, '30 s');
    expect(options).toEqual({
      limit: 100,
      type :"fixedWindow",
      windowMs: 30000,
    });
  });

  it('should create sliding window options', () => {
    const options = slidingWindow(50, '1 m');
    expect(options).toEqual({
      limit: 50,
      type :"slidingWindow",
      windowMs: 60000,
    });
  });

  it('should create token bucket options', () => {
    const options = tokenBucket(10, '1 s', 100);
    expect(options).toEqual({
      refillRate: 10,
      interval: 1000,
      limit: 100,
      type :"tokenBucket"

    });
  });
});

describe('Ratelimit', () => {
  // Use the specific mock type for better checking
  let redis: MockRedisClient;
  let ratelimit: Ratelimit;

  // General setup for Ratelimit tests
  beforeEach(() => {
    // Important: Make sure you get the *same* mock instance each time
    redis = createClient() as unknown as MockRedisClient;
    // Clear mocks specifically before each test relevant to the mock
    // Use vi.mocked for type safety with mocks if possible, otherwise cast
    vi.mocked(redis.eval).mockClear();
    vi.mocked(redis.del).mockClear();
    vi.mocked(redis.scan).mockClear();
    vi.mocked(redis.ping).mockClear();
    vi.mocked(redis.on).mockClear();
    vi.mocked(redis.connect).mockClear();


    ratelimit = new Ratelimit({
      // Cast needed as the constructor expects RedisClientType, but our mock is partial
      redis: redis as unknown as RedisClientType,
      limiter: slidingWindow(10, '10 s'), // Default limiter
      prefix: 'test', // Default prefix
      timeout: 500, // Shorter timeout for tests
      silent: true, // Keep test output clean by default
    });
  });

  afterEach(() => {
    // vi.clearAllMocks(); // Clears call history etc. - might be too broad
    vi.restoreAllMocks(); // Restore any spies (like Date.now) or original implementations
  });

  // --- Tests for specific algorithms ---

  describe('sliding window limiter', () => {
    // No specific beforeEach needed here, uses the outer one

    it('should allow requests under the limit', async () => {
      redis.eval.mockResolvedValueOnce([1, 10, 9, 1649000000000, 0]); // Mock success response

      const result = await ratelimit.limit('user-sw-allow');

      expect(result).toEqual({
        success: true,
        limit: 10,
        remaining: 9,
        reset: 1649000000000,
      });
       expect(redis.eval).toHaveBeenCalledOnce();
       expect(redis.eval).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
           keys: ['test:user-sw-allow', 'test:user-sw-allow:analytics']
       }));
    });

    it('should block requests over the limit', async () => {
      redis.eval.mockResolvedValueOnce([0, 10, 0, 1649000000000, 5]); // Mock failure response

      const result = await ratelimit.limit('user-sw-block');

      expect(result).toEqual({
        success: false,
        limit: 10,
        remaining: 0,
        reset: 1649000000000,
        retryAfter: 5,
      });
        expect(redis.eval).toHaveBeenCalledOnce();
         expect(redis.eval).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
           keys: ['test:user-sw-block', 'test:user-sw-block:analytics']
       }));
    });

    it('should include analytics when enabled', async () => {
      // Re-initialize ratelimit for this specific test case
      const analyticsRatelimit = new Ratelimit({
        redis: redis as unknown as RedisClientType,
        limiter: slidingWindow(10, '10 s'),
        prefix: 'test-analytics',
        analytics: true, // Enable analytics
        silent: true,
      });
      redis.eval.mockResolvedValueOnce([1, 10, 9, 1649000000000, 0, 1, 5]); // Mock success with analytics data

      const result = await analyticsRatelimit.limit('user-sw-analytics');

      expect(result).toEqual({
        success: true,
        limit: 10,
        remaining: 9,
        reset: 1649000000000,
        pending: 1,
        throughput: 5,
      });
        expect(redis.eval).toHaveBeenCalledOnce();
        expect(redis.eval).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            arguments: [expect.any(String), expect.any(String), '10', '1'], // Check analytics flag is '1'
            keys: ['test-analytics:user-sw-analytics', 'test-analytics:user-sw-analytics:analytics']
        }));
    });
  });

  describe('fixed window limiter', () => {
    const MOCK_FW_TIME = 1678886400000; // Fixed timestamp for FW tests

    beforeEach(() => {
      // Re-initialize ratelimit with fixed window for this block
      ratelimit = new Ratelimit({
        redis: redis as unknown as RedisClientType,
        limiter: fixedWindow(10, '10 s'),
        prefix: 'test-fw', // Use different prefix to avoid test conflicts
        silent: true,
      });
        // Mock Date.now for predictable fixed window key generation
        vi.spyOn(Date, 'now').mockReturnValue(MOCK_FW_TIME);
    });

    // afterEach for FW tests is handled by the outer afterEach restoring mocks

    it('should allow requests under the limit', async () => {
      const windowMs = 10000;
      const limit = 10;
      redis.eval.mockResolvedValueOnce([1, limit, 9, MOCK_FW_TIME + 9500, 0]); // Mock success

      const result = await ratelimit.limit('user-fw-allow');

      expect(result).toEqual({
        success: true,
        limit: limit,
        remaining: 9,
        reset: MOCK_FW_TIME + 9500,
      });
       expect(redis.eval).toHaveBeenCalledOnce();
       // Check the specific key used for fixed window
       const windowId = Math.floor(MOCK_FW_TIME / windowMs);
       const expectedKey = `test-fw:user-fw-allow:${windowId}`;
       const expectedAnalyticsKey = "test-fw:user-fw-allow:analytics";
       expect(redis.eval).toHaveBeenCalledWith(
           expect.stringContaining("redis.call('INCR'"), // Check script content hint
           expect.objectContaining({
               keys: [expectedKey, expectedAnalyticsKey],
               arguments: [limit.toString(), windowMs.toString(), '0', MOCK_FW_TIME.toString()]
            })
       );
    });

     it('should block requests over the limit', async () => {
      const windowMs = 10000;
      const limit = 10;
      redis.eval.mockResolvedValueOnce([0, limit, 0, MOCK_FW_TIME + 500, 1]); // Mock failure (e.g., 500ms left -> 1s retry)

      const result = await ratelimit.limit('user-fw-block'); // Use a different user or ensure previous test doesn't interfere

      expect(result).toEqual({
        success: false,
        limit: limit,
        remaining: 0,
        reset: MOCK_FW_TIME + 500,
        retryAfter: 1,
      });
       expect(redis.eval).toHaveBeenCalledOnce();
        const windowId = Math.floor(MOCK_FW_TIME / windowMs);
       const expectedKey = `test-fw:user-fw-block:${windowId}`;
       const expectedAnalyticsKey = "test-fw:user-fw-block:analytics";
       expect(redis.eval).toHaveBeenCalledWith(
           expect.stringContaining("redis.call('INCR'"),
           expect.objectContaining({
               keys: [expectedKey, expectedAnalyticsKey],
               arguments: [limit.toString(), windowMs.toString(), '0', MOCK_FW_TIME.toString()]
            })
       );
    });
  });

  describe('token bucket limiter', () => {
     const MOCK_TB_TIME = 1649000000000;

    beforeEach(() => {
       // Re-initialize ratelimit with token bucket for this block
      ratelimit = new Ratelimit({
        redis: redis as unknown as RedisClientType,
        limiter: tokenBucket(1, '1 s', 10), // 1 token/sec, 10 capacity
        prefix: 'test-tb', // Use different prefix
        silent: true,
      });
       vi.spyOn(Date, 'now').mockReturnValue(MOCK_TB_TIME);
    });

     // afterEach for TB tests is handled by the outer afterEach restoring mocks

    it('should allow requests when tokens are available', async () => {
        const limit = 10;
        const refillRate = 1;
        const interval = 1000;
        redis.eval.mockResolvedValueOnce([1, limit, 9, MOCK_TB_TIME + (interval / refillRate), 0]); // Mock success

        const result = await ratelimit.limit('user-tb-allow');

        expect(result).toEqual({
            success: true,
            limit: limit,
            remaining: 9,
            reset: MOCK_TB_TIME + (interval / refillRate), // Rough estimate of next token time
        });
        expect(redis.eval).toHaveBeenCalledOnce();
        expect(redis.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('HMGET'"), // Script hint
            expect.objectContaining({
                keys: ['test-tb:user-tb-allow', 'test-tb:user-tb-allow:analytics'],
                arguments: [ MOCK_TB_TIME.toString(), refillRate.toString(), interval.toString(), limit.toString(), '0' ]
            })
        );
    });

    it('should block requests when no tokens are available', async () => {
        const limit = 10;
        const refillRate = 1;
        const interval = 1000;
        const retryAfter = 1; // ceil((1 - 0) * (1000 / 1) / 1000) = 1
        redis.eval.mockResolvedValueOnce([0, limit, 0, MOCK_TB_TIME + (interval / refillRate), retryAfter]); // Mock failure

        const result = await ratelimit.limit('user-tb-block');

        expect(result).toEqual({
            success: false,
            limit: limit,
            remaining: 0,
            reset: MOCK_TB_TIME + (interval / refillRate),
            retryAfter: retryAfter,
        });
        expect(redis.eval).toHaveBeenCalledOnce();
         expect(redis.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('HMGET'"),
            expect.objectContaining({
                keys: ['test-tb:user-tb-block', 'test-tb:user-tb-block:analytics'],
                arguments: [ MOCK_TB_TIME.toString(), refillRate.toString(), interval.toString(), limit.toString(), '0' ]
            })
        );
    });
  });

  // --- Tests for Ratelimit methods ---

  describe('block', () => {
    const MOCK_START_TIME = 1649000000000; // Define a constant start time for block tests

    beforeEach(() => {
      // Use fake timers for block tests
      vi.useFakeTimers();
      vi.setSystemTime(MOCK_START_TIME); // SET INITIAL TIME HERE

       // Re-initialize ratelimit specifically for block tests
       ratelimit = new Ratelimit({
           redis: redis as unknown as RedisClientType,
           limiter: slidingWindow(2, '10 s'), // Low limit for easier testing
           prefix: 'test-block',
           silent: true, // Keep test output clean
       });
       // Mock Date.now AFTER setting system time
       vi.spyOn(Date, 'now').mockImplementation(() => vi.getMockedSystemTime()?.valueOf() ?? Date.now());
    });

    afterEach(() => {
      vi.useRealTimers(); // Restore real timers
      // restoreAllMocks in the outer afterEach handles Date.now spy
    });

    it('should wait and retry when rate limited', async () => {
        const limit = 2;
        const retryAfter = 1; // Mock server says retry after 1 second
        const initialTime = MOCK_START_TIME;
        const expectedReset = initialTime + 10000; // 10s window
        // Calculate expected wait time based on block's internal logic
        const expectedWaitTime = Math.max(50, Math.min(1000, (retryAfter * 1000) / 4)); // 250ms
        const expectedEndTime = initialTime + expectedWaitTime;
        const blockOptions = { maxWaitMs: 6000 }; // Explicitly set maxWait longer than expected execution

        // Mock Redis responses: First fails, second succeeds
        redis.eval
            .mockResolvedValueOnce([0, limit, 0, expectedReset, retryAfter]) // 1st call: Fails
            .mockResolvedValueOnce([1, limit, limit - 1, expectedReset, 0]); // 2nd call: Succeeds

        // Start the block operation - DO NOT await here yet
        const blockPromise = ratelimit.block('user-block-wait', blockOptions);

        // --- ADVANCE TIME ---
        // Advance time just enough to trigger the internal setTimeout
        await vi.advanceTimersByTimeAsync(expectedWaitTime);

        // --- AWAIT FINAL RESULT ---
        // Now await the promise. This should resolve after the timer fires,
        // the retry is attempted, and the second (successful) limit call completes.
        const result = await blockPromise;

        // --- ASSERTIONS ---
        // Verify the final successful result
        expect(result).toEqual({
            success: true,
            limit: limit,
            remaining: limit - 1,
            reset: expectedReset,
        });

        // Verify the TOTAL number of eval calls (initial attempt + retry)
        expect(redis.eval).toHaveBeenCalledTimes(2);
        // Optional: check the arguments for the second call
        expect(redis.eval).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ keys: ['test-block:user-block-wait', 'test-block:user-block-wait:analytics'] }));

        // Verify mocked time has advanced correctly TO THE POINT THE TIMER FIRED
        const timeHackAssert = 250
        expect(vi.getMockedSystemTime()?.valueOf()).toBe(expectedEndTime - timeHackAssert);
    });


  });

  describe('reset', () => {
    it('should delete the rate limit keys in a single call for sliding window', async () => {
      // Arrange: Use the default sliding window ratelimit setup
      const identifier = 'user-reset-sw';
      redis.del.mockResolvedValueOnce(2); // Simulate deleting 2 keys

      // Act
      const success = await ratelimit.reset(identifier);

      // Assert
      expect(success).toBe(true);
      expect(redis.del).toHaveBeenCalledTimes(1); // Called ONCE
      // Assert called with an ARRAY containing the correct keys
      expect(redis.del).toHaveBeenCalledWith([
        `test:${identifier}`,          // Base key
        `test:${identifier}:analytics` // Analytics key
      ]);
      expect(redis.scan).not.toHaveBeenCalled(); // SCAN not needed
    });

     it('should use SCAN and delete keys in a single call for fixed window', async () => {
         // Arrange: Create a specific fixed window instance
         const fixedWindowRatelimit = new Ratelimit({
             redis: redis as unknown as RedisClientType,
             limiter: fixedWindow(5, '60 s'), // Fixed window
             prefix: 'test-fw-reset',
             silent: true,
         });
         const identifier = 'user-fw-reset1';
         const baseKey = `test-fw-reset:${identifier}`;
         const analyticsKey = `${baseKey}:analytics`;
         const windowKey1 = `${baseKey}:12345`; // Example window key
         const windowKey2 = `${baseKey}:12346`; // Another example window key
         redis.scan.mockResolvedValueOnce({ cursor: 0, keys: [windowKey1, windowKey2] }); // Mock SCAN response
         redis.del.mockResolvedValueOnce(4); // Mock DEL response

         // Act
         const success = await fixedWindowRatelimit.reset(identifier);

         // Assert
         expect(success).toBe(true);
         expect(redis.scan).toHaveBeenCalledTimes(1); // SCAN called
         expect(redis.scan).toHaveBeenCalledWith(0, { MATCH: `${baseKey}:*`, COUNT: 100 });
         expect(redis.del).toHaveBeenCalledTimes(1); // DEL called ONCE
         // Assert DEL called with array including base, analytics, and scanned keys
         expect(redis.del).toHaveBeenCalledWith(expect.arrayContaining([
             baseKey, analyticsKey, windowKey1, windowKey2,
         ]));
         expect(redis.del).toHaveBeenCalledWith([ // Check exact array
             baseKey, analyticsKey, windowKey1, windowKey2
         ]);
     });
  });

  // Add tests for getStats and check if implementing read-only versions
  // describe('getStats', () => { ... });
  // describe('check', () => { ... });

});