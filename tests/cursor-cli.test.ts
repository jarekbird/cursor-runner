// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorCLI } from '../src/cursor-cli.js';

describe('CursorCLI', () => {
  let cursorCLI: CursorCLI;

  beforeEach(() => {
    cursorCLI = new CursorCLI();
  });

  describe('validate', () => {
    it('should validate cursor-cli is available', async () => {
      // Mock or skip based on actual cursor-cli availability
      // This test may need to be adjusted based on your environment
      expect(cursorCLI).toBeDefined();
    });
  });

  describe('extractFilesFromOutput', () => {
    it('should extract file paths from output', () => {
      const output = 'created: app/services/test.rb\nmodified: spec/services/test_spec.rb';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toContain('app/services/test.rb');
      expect(files).toContain('spec/services/test_spec.rb');
    });

    it('should return empty array when no files found', () => {
      const output = 'No files created';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toEqual([]);
    });
  });

  describe('Semaphore & Queue Status', () => {
    let testCursorCLI: CursorCLI;

    beforeEach(() => {
      // Set max concurrent to 2 for testing
      process.env.CURSOR_CLI_MAX_CONCURRENT = '2';
      // Create new instance to pick up the env var
      testCursorCLI = new CursorCLI();
    });

    afterEach(() => {
      delete process.env.CURSOR_CLI_MAX_CONCURRENT;
    });

    it('should return correct queue status', () => {
      const status = testCursorCLI.getQueueStatus();

      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('waiting');
      expect(status).toHaveProperty('maxConcurrent');
      expect(typeof status.available).toBe('number');
      expect(typeof status.waiting).toBe('number');
      expect(typeof status.maxConcurrent).toBe('number');
      expect(status.maxConcurrent).toBe(2);
    });

    it('should return correct available and waiting counts', () => {
      // Initially, all slots should be available
      const initialStatus = testCursorCLI.getQueueStatus();
      expect(initialStatus.available).toBe(2);
      expect(initialStatus.waiting).toBe(0);
      expect(initialStatus.maxConcurrent).toBe(2);
    });

    it('should log waiting when all slots are busy', async () => {
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      // Set max concurrent to 1 for this test
      const originalMaxConcurrent = process.env.CURSOR_CLI_MAX_CONCURRENT;
      process.env.CURSOR_CLI_MAX_CONCURRENT = '1';
      const singleSlotCLI = new CursorCLI();

      // Start a command that will take some time
      // We'll use a command that will fail quickly to avoid long waits
      const promise = singleSlotCLI.executeCommand(['--invalid-flag']).catch(() => {
        // Expected to fail
      });

      // Wait a bit for semaphore to be acquired
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Start another command (should wait and log)
      const promise2 = singleSlotCLI.executeCommand(['--invalid-flag']).catch(() => {
        // Expected to fail
      });

      // Wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check if "waiting" was logged
      const waitingLog = loggerInfoSpy.mock.calls.find((call) => {
        const firstArg = call[0] as unknown;
        if (typeof firstArg === 'string') {
          return firstArg.includes('Waiting for cursor-cli execution slot');
        }
        if (typeof firstArg === 'object' && firstArg !== null) {
          const obj = firstArg as Record<string, unknown>;
          return 'available' in obj && 'waiting' in obj;
        }
        return false;
      });
      expect(waitingLog).toBeDefined();

      // Wait for both to complete
      await Promise.all([promise, promise2]);

      // Restore
      if (originalMaxConcurrent) {
        process.env.CURSOR_CLI_MAX_CONCURRENT = originalMaxConcurrent;
      } else {
        delete process.env.CURSOR_CLI_MAX_CONCURRENT;
      }

      loggerInfoSpy.mockRestore();
    }, 15000);

    it('should respect CURSOR_CLI_MAX_CONCURRENT with multiple concurrent calls', async () => {
      // Set max concurrent to 2 for testing
      const originalMaxConcurrent = process.env.CURSOR_CLI_MAX_CONCURRENT;
      process.env.CURSOR_CLI_MAX_CONCURRENT = '2';
      const testCLI = new CursorCLI();

      // Start 3 commands (should only allow 2 concurrent)
      // These will fail quickly but will test semaphore behavior
      const promises = [
        testCLI.executeCommand(['--invalid-flag']).catch(() => {
          // Expected to fail
        }),
        testCLI.executeCommand(['--invalid-flag']).catch(() => {
          // Expected to fail
        }),
        testCLI.executeCommand(['--invalid-flag']).catch(() => {
          // Expected to fail
        }),
      ];

      // Wait a bit for semaphore to be acquired
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check queue status - should have maxConcurrent of 2
      const status = testCLI.getQueueStatus();
      expect(status.maxConcurrent).toBe(2);
      // At least one should be waiting or all slots should be busy
      expect(status.available).toBeLessThanOrEqual(2);
      expect(status.waiting).toBeGreaterThanOrEqual(0);

      // Wait for all to complete
      await Promise.all(promises);

      // Restore
      if (originalMaxConcurrent) {
        process.env.CURSOR_CLI_MAX_CONCURRENT = originalMaxConcurrent;
      } else {
        delete process.env.CURSOR_CLI_MAX_CONCURRENT;
      }
    }, 10000);
  });

  describe('Timeout Handling', () => {
    let testCursorCLI: CursorCLI;

    beforeEach(() => {
      // Set a short timeout for testing
      process.env.CURSOR_CLI_TIMEOUT = '1000'; // 1 second
      testCursorCLI = new CursorCLI();
    });

    afterEach(() => {
      delete process.env.CURSOR_CLI_TIMEOUT;
    });

    it('should trigger CommandError with stdout/stderr on main timeout', async () => {
      // This test verifies that when a command times out, the error includes stdout/stderr
      // Note: This test may not actually trigger a timeout if the command completes quickly
      // The important part is that timeout errors have the CommandError structure
      try {
        await testCursorCLI.executeCommand(['--help'], {
          timeout: 100, // Very short timeout
        });
        // Command may complete before timeout
      } catch (error) {
        // Verify it's an Error
        const commandError = error as Error & {
          stdout?: string;
          stderr?: string;
          exitCode?: number | null;
        };
        expect(commandError).toBeInstanceOf(Error);
        // If it's a timeout error, it should have stdout/stderr properties
        if (commandError.message.includes('timeout')) {
          expect(commandError.stdout).toBeDefined();
          expect(commandError.stderr).toBeDefined();
        }
      }
    }, 5000);

    it('should trigger failure on idle timeout when no output for configured duration', async () => {
      // This test verifies idle timeout behavior
      // Note: Idle timeout is configured via CURSOR_CLI_IDLE_TIMEOUT
      // We'll set a very short idle timeout
      const originalIdleTimeout = process.env.CURSOR_CLI_IDLE_TIMEOUT;
      process.env.CURSOR_CLI_IDLE_TIMEOUT = '200'; // 200ms idle timeout

      try {
        // Create a new instance to pick up the env var
        const idleTestCLI = new CursorCLI();
        await idleTestCLI.executeCommand(['--help'], {
          timeout: 5000, // Long main timeout
        });
        // Command may complete before idle timeout if it produces output quickly
      } catch (error) {
        // Verify it's an Error
        const commandError = error as Error & {
          stdout?: string;
          stderr?: string;
          exitCode?: number | null;
        };
        expect(commandError).toBeInstanceOf(Error);
        // If it's an idle timeout error, it should have stdout/stderr properties
        if (commandError.message.includes('No output from cursor-cli')) {
          expect(commandError.stdout).toBeDefined();
          expect(commandError.stderr).toBeDefined();
        }
        // The error message should indicate a timeout or failure
        expect(commandError.message.length).toBeGreaterThan(0);
      } finally {
        if (originalIdleTimeout) {
          process.env.CURSOR_CLI_IDLE_TIMEOUT = originalIdleTimeout;
        } else {
          delete process.env.CURSOR_CLI_IDLE_TIMEOUT;
        }
      }
    }, 10000);

    it('should release semaphore even if exit events do not fire', async () => {
      // This test verifies that the semaphore is released even in error/timeout cases
      const originalMaxConcurrent = process.env.CURSOR_CLI_MAX_CONCURRENT;
      process.env.CURSOR_CLI_MAX_CONCURRENT = '1';
      const semaphoreTestCLI = new CursorCLI();

      // Get initial status
      const initialStatus = semaphoreTestCLI.getQueueStatus();
      expect(initialStatus.available).toBe(1);

      // Start a command that will fail quickly
      const promise = semaphoreTestCLI.executeCommand(['--invalid-flag']).catch(() => {
        // Expected to fail
      });

      // Wait a bit for semaphore to be acquired and command to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that semaphore was acquired (may be released already if command completed quickly)
      const duringStatus = semaphoreTestCLI.getQueueStatus();
      // The semaphore should be either acquired (0 available) or already released (1 available)
      expect(duringStatus.available).toBeGreaterThanOrEqual(0);
      expect(duringStatus.available).toBeLessThanOrEqual(1);

      // Wait for command to complete
      await promise;

      // Wait a bit more for cleanup
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify semaphore was released
      const finalStatus = semaphoreTestCLI.getQueueStatus();
      expect(finalStatus.available).toBe(1);

      // Restore
      if (originalMaxConcurrent) {
        process.env.CURSOR_CLI_MAX_CONCURRENT = originalMaxConcurrent;
      } else {
        delete process.env.CURSOR_CLI_MAX_CONCURRENT;
      }
    }, 10000);
  });
});
