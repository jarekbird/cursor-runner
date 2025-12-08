/**
 * Shared test utilities for cleanup and setup
 * Ensures all tests properly clean up resources to prevent hanging
 */
import type { Server } from '../src/server.js';
import type Redis from 'ioredis';

export interface TestCleanup {
  server?: Server;
  redis?: Redis;
  cleanup: () => Promise<void>;
}

/**
 * Options for creating a mock Redis client
 */
export interface MockRedisOptions {
  /**
   * Simulate connection failure - all operations will reject
   */
  simulateConnectionFailure?: boolean;
  /**
   * Initial connection status
   */
  initialStatus?: 'ready' | 'connecting' | 'end' | 'close';
}

/**
 * In-memory storage for mock Redis
 */
interface MockRedisStorage {
  strings: Map<string, { value: string; expiresAt?: number }>;
  sets: Map<string, Set<string>>;
}

/**
 * Creates a fully functional mock Redis client for testing
 * Supports basic Redis operations: get, set, setex, smembers, sadd, srem, del, exists, expire, keys
 *
 * @param options - Configuration options for the mock client
 * @returns A mock Redis client that implements the ioredis interface
 *
 * @example
 * ```typescript
 * const mockRedis = createMockRedisClient();
 * await mockRedis.set('key', 'value');
 * const value = await mockRedis.get('key'); // 'value'
 * ```
 *
 * @example
 * ```typescript
 * // Simulate connection failure
 * const mockRedis = createMockRedisClient({ simulateConnectionFailure: true });
 * await mockRedis.get('key'); // throws error
 * ```
 */
export function createMockRedisClient(options: MockRedisOptions = {}): Partial<Redis> {
  const storage: MockRedisStorage = {
    strings: new Map(),
    sets: new Map(),
  };

  const { simulateConnectionFailure = false, initialStatus = 'ready' } = options;
  let status: 'ready' | 'connecting' | 'end' | 'close' = initialStatus;

  // Helper to check if key has expired
  const isExpired = (key: string): boolean => {
    const entry = storage.strings.get(key);
    if (!entry || !entry.expiresAt) {
      return false;
    }
    if (Date.now() >= entry.expiresAt) {
      storage.strings.delete(key);
      return true;
    }
    return false;
  };

  // Helper to throw connection error if configured
  const checkConnection = (): void => {
    if (simulateConnectionFailure || status === 'close') {
      throw new Error('Redis connection failed');
    }
  };

  const mockRedis: Partial<Redis> & { status: typeof status } = {
    get status() {
      return status;
    },
    set status(value: typeof status) {
      status = value;
    },

    async get(key: string): Promise<string | null> {
      checkConnection();
      if (isExpired(key)) {
        return null;
      }
      const entry = storage.strings.get(key);
      return entry ? entry.value : null;
    },

    async set(key: string, value: string): Promise<'OK'> {
      checkConnection();
      storage.strings.set(key, { value });
      return 'OK';
    },

    async setex(key: string, seconds: number, value: string): Promise<'OK'> {
      checkConnection();
      const expiresAt = Date.now() + seconds * 1000;
      storage.strings.set(key, { value, expiresAt });
      return 'OK';
    },

    async smembers(key: string): Promise<string[]> {
      checkConnection();
      const set = storage.sets.get(key);
      return set ? Array.from(set) : [];
    },

    sadd: (async (key: string, ...members: (string | number | Buffer)[]): Promise<number> => {
      checkConnection();
      let set = storage.sets.get(key);
      if (!set) {
        set = new Set();
        storage.sets.set(key, set);
      }
      let added = 0;
      for (const member of members) {
        const memberStr = String(member);
        if (!set.has(memberStr)) {
          set.add(memberStr);
          added++;
        }
      }
      return added;
    }) as any,

    srem: (async (key: string, ...members: (string | number | Buffer)[]): Promise<number> => {
      checkConnection();
      const set = storage.sets.get(key);
      if (!set) {
        return 0;
      }
      let removed = 0;
      for (const member of members) {
        const memberStr = String(member);
        if (set.delete(memberStr)) {
          removed++;
        }
      }
      if (set.size === 0) {
        storage.sets.delete(key);
      }
      return removed;
    }) as any,

    del: (async (...keys: string[]): Promise<number> => {
      checkConnection();
      let deleted = 0;
      for (const key of keys) {
        if (storage.strings.delete(key)) {
          deleted++;
        }
        if (storage.sets.delete(key)) {
          deleted++;
        }
      }
      return deleted;
    }) as any,

    exists: (async (...keys: string[]): Promise<number> => {
      checkConnection();
      let count = 0;
      for (const key of keys) {
        if (!isExpired(key) && (storage.strings.has(key) || storage.sets.has(key))) {
          count++;
        }
      }
      return count;
    }) as any,

    async expire(key: string, seconds: number): Promise<number> {
      checkConnection();
      const entry = storage.strings.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + seconds * 1000;
        return 1;
      }
      return 0;
    },

    async keys(pattern: string): Promise<string[]> {
      checkConnection();
      const allKeys: string[] = [];

      // Convert glob pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);

      // Check string keys
      for (const key of storage.strings.keys()) {
        if (!isExpired(key) && regex.test(key)) {
          allKeys.push(key);
        }
      }

      // Check set keys
      for (const key of storage.sets.keys()) {
        if (regex.test(key)) {
          allKeys.push(key);
        }
      }

      return allKeys;
    },

    async quit(): Promise<'OK'> {
      status = 'end';
      storage.strings.clear();
      storage.sets.clear();
      return 'OK';
    },

    async disconnect(): Promise<void> {
      status = 'end';
      storage.strings.clear();
      storage.sets.clear();
    },
  };

  return mockRedis;
}

/**
 * Create a cleanup function that properly shuts down all resources
 * This ensures Jest exits cleanly and tests don't hang
 */
export async function createTestCleanup(server?: Server, redis?: Redis): Promise<TestCleanup> {
  const cleanup = async (): Promise<void> => {
    // Stop server if it exists
    if (server && typeof server.stop === 'function') {
      try {
        await server.stop();
      } catch (error) {
        // Ignore errors during cleanup
        console.warn('Error stopping server during cleanup:', error);
      }
    }

    // Close Redis connection if it exists
    if (redis && redis.status === 'ready') {
      try {
        await redis.quit();
      } catch (error) {
        // Ignore errors during cleanup
        console.warn('Error closing Redis during cleanup:', error);
      }
    }
  };

  return {
    server,
    redis,
    cleanup,
  };
}

/**
 * Setup Jest afterAll hook with proper cleanup
 * Use this in test files to ensure resources are cleaned up
 */
export function setupTestCleanup(cleanupFn: () => Promise<void>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jestGlobals = global as any;

  // Store cleanup function
  if (!jestGlobals.__testCleanupFunctions) {
    jestGlobals.__testCleanupFunctions = [];
  }
  jestGlobals.__testCleanupFunctions.push(cleanupFn);
}

/**
 * Execute all registered cleanup functions
 * Call this in afterAll hooks
 */
export async function executeAllCleanups(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jestGlobals = global as any;
  const cleanups = jestGlobals.__testCleanupFunctions || [];

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      console.warn('Error during test cleanup:', error);
    }
  }

  // Clear the array
  jestGlobals.__testCleanupFunctions = [];
}
