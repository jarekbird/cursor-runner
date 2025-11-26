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
 * Create a cleanup function that properly shuts down all resources
 * This ensures Jest exits cleanly and tests don't hang
 */
export async function createTestCleanup(
  server?: Server,
  redis?: Redis
): Promise<TestCleanup> {
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

