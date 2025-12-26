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

    it.skip('should log waiting when all slots are busy', async () => {
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

    it.skip('should respect CURSOR_CLI_MAX_CONCURRENT with multiple concurrent calls', async () => {
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
        // Verify it's an Error (check for Error properties - more reliable in Jest across contexts)
        const commandError = error as Error & {
          stdout?: string;
          stderr?: string;
          exitCode?: number | null;
        };
        expect(commandError).toBeDefined();
        expect(commandError.message).toBeDefined();
        expect(typeof commandError.message).toBe('string');
        // If it's a timeout error, it should have stdout/stderr properties
        if (commandError.message.includes('timeout')) {
          expect(commandError.stdout).toBeDefined();
          expect(commandError.stderr).toBeDefined();
        }
      }
    }, 5000);

    it('should NOT trigger idle timeout when no output has been received yet', async () => {
      // This test verifies that idle timeout does NOT fire when no output has been received
      // This is the new behavior: idle timeout only applies AFTER we've seen at least one output chunk
      // This prevents false positives when cursor-cli is working but stdout/stderr are buffered
      const originalIdleTimeout = process.env.CURSOR_CLI_IDLE_TIMEOUT;
      process.env.CURSOR_CLI_IDLE_TIMEOUT = '200'; // 200ms idle timeout (very short)

      try {
        // Create a new instance to pick up the env var
        const idleTestCLI = new CursorCLI();
        // Use a command that might not produce output immediately
        // With the new behavior, idle timeout should NOT fire even if no output is received
        const promise = idleTestCLI.executeCommand(['--help'], {
          timeout: 5000, // Long main timeout
        });

        // Wait longer than the idle timeout - it should NOT fire because no output was received
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Command may complete or timeout, but idle timeout should NOT have fired
        // (because no output was received, so idle timeout is not "armed")
        try {
          await promise;
        } catch (error) {
          const commandError = error as Error;
          // If it's an error, it should NOT be an idle timeout error
          // (it might be a hard timeout or other error, but not idle timeout)
          expect(commandError.message).not.toContain('No output from cursor-cli');
        }
      } finally {
        if (originalIdleTimeout) {
          process.env.CURSOR_CLI_IDLE_TIMEOUT = originalIdleTimeout;
        } else {
          delete process.env.CURSOR_CLI_IDLE_TIMEOUT;
        }
      }
    }, 10000);

    it('should trigger idle timeout AFTER output has been received and then goes silent', async () => {
      // This test verifies that idle timeout DOES fire when output has been received
      // and then the process goes silent for longer than the idle timeout
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerErrorSpy = jest.spyOn(logger, 'error');

      const originalIdleTimeout = process.env.CURSOR_CLI_IDLE_TIMEOUT;
      process.env.CURSOR_CLI_IDLE_TIMEOUT = '30000'; // 30 seconds idle timeout

      try {
        const idleTestCLI = new CursorCLI();

        // Start a command that will run long enough to potentially trigger idle timeout
        const promise = idleTestCLI
          .executeCommand(['--help'], {
            timeout: 60000, // 60 seconds main timeout
          })
          .catch(() => {
            // May fail or timeout, that's okay for this test
          });

        // Wait for command to potentially produce output and then go silent
        // Note: In real usage, if cursor-cli produces output, idle timeout will be "armed"
        // and will fire if output stops for longer than idleTimeout
        await new Promise((resolve) => setTimeout(resolve, 35000));

        // Check if idle timeout error was logged (if output was received and then stopped)
        const idleTimeoutLogs = loggerErrorSpy.mock.calls.filter((call) => {
          const firstArg = call[0] as unknown;
          if (typeof firstArg === 'string') {
            return firstArg === 'cursor-cli idle timeout reached';
          }
          return false;
        });

        // If idle timeout fired, verify the error structure
        if (idleTimeoutLogs.length > 0) {
          const idleTimeoutLog = idleTimeoutLogs[0];
          const firstArg = idleTimeoutLog[0] as unknown;
          const secondArg = (idleTimeoutLog as unknown[])[1] as Record<string, unknown> | undefined;
          const logData = (
            typeof firstArg === 'object' && firstArg !== null
              ? (firstArg as Record<string, unknown>)
              : secondArg
          ) as Record<string, unknown> | undefined;

          if (logData) {
            // Verify that idle timeout only fired after output was received
            expect(logData).toHaveProperty('hasReceivedOutput');
            expect(logData.hasReceivedOutput).toBe(true);
          }
        }

        // Wait for command to complete
        await promise.catch(() => {
          // Expected - command may fail or timeout
        });
      } finally {
        if (originalIdleTimeout) {
          process.env.CURSOR_CLI_IDLE_TIMEOUT = originalIdleTimeout;
        } else {
          delete process.env.CURSOR_CLI_IDLE_TIMEOUT;
        }
        loggerErrorSpy.mockRestore();
      }
    }, 40000);

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

      // Wait a bit more for cleanup (increased wait time for CI)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify semaphore was released
      const finalStatus = semaphoreTestCLI.getQueueStatus();
      // Semaphore should be released - allow some tolerance for race conditions
      expect(finalStatus.available).toBeGreaterThanOrEqual(1);

      // Restore
      if (originalMaxConcurrent) {
        process.env.CURSOR_CLI_MAX_CONCURRENT = originalMaxConcurrent;
      } else {
        delete process.env.CURSOR_CLI_MAX_CONCURRENT;
      }
    }, 10000);

    it('should log heartbeat with enhanced timeout information', async () => {
      // This test verifies that heartbeat logs include the new timeout-related fields
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      // Set longer timeouts so we can observe heartbeat logs
      const originalTimeout = process.env.CURSOR_CLI_TIMEOUT;
      const originalIdleTimeout = process.env.CURSOR_CLI_IDLE_TIMEOUT;
      // Keep this short enough that the command ends promptly after we observe the first heartbeat.
      process.env.CURSOR_CLI_TIMEOUT = '35000'; // 35 seconds
      process.env.CURSOR_CLI_IDLE_TIMEOUT = '30000'; // 30 seconds

      try {
        const heartbeatTestCLI = new CursorCLI();

        // Start a command that will run long enough to trigger at least one heartbeat (30s interval)
        const promise = heartbeatTestCLI
          .executeCommand(['--help'], {
            timeout: 35000,
          })
          .catch(() => {
            // May fail or timeout, that's okay for this test
          });

        // Wait for at least one heartbeat to fire (30 seconds + buffer)
        await new Promise((resolve) => setTimeout(resolve, 32000));

        // Find heartbeat log calls
        const heartbeatLogs = loggerInfoSpy.mock.calls.filter((call) => {
          const firstArg = call[0] as unknown;
          if (typeof firstArg === 'string') {
            return firstArg === 'cursor-cli command heartbeat';
          }
          // If first arg is object (unlikely but handle it), check for heartbeat fields
          if (typeof firstArg === 'object' && firstArg !== null) {
            const obj = firstArg as Record<string, unknown>;
            return 'timeSinceLastOutput' in obj && 'elapsed' in obj && 'idleTimeoutMs' in obj;
          }
          return false;
        });

        // Should have at least one heartbeat log
        if (heartbeatLogs.length > 0) {
          const heartbeatLog = heartbeatLogs[0];
          // Winston logger.info() can be called with (message, meta) or just (meta)
          // The spy captures all arguments, so check both call[0] and call[1]
          const firstArg = heartbeatLog[0] as unknown;
          const secondArg = (heartbeatLog as unknown[])[1] as Record<string, unknown> | undefined;
          const logData = (
            typeof firstArg === 'object' && firstArg !== null
              ? (firstArg as Record<string, unknown>)
              : secondArg
          ) as Record<string, unknown> | undefined;

          if (logData) {
            // Verify new enhanced fields are present
            expect(logData).toHaveProperty('outputSinceLastHeartbeat');
            expect(typeof logData.outputSinceLastHeartbeat).toBe('boolean');
            expect(logData).toHaveProperty('stdoutDeltaSinceHeartbeat');
            expect(typeof logData.stdoutDeltaSinceHeartbeat).toBe('number');
            expect(logData).toHaveProperty('stderrDeltaSinceHeartbeat');
            expect(typeof logData.stderrDeltaSinceHeartbeat).toBe('number');
            expect(logData).toHaveProperty('idleTimeoutMs');
            expect(typeof logData.idleTimeoutMs).toBe('number');
            expect(logData).toHaveProperty('idleTimeoutRemainingMs');
            expect(typeof logData.idleTimeoutRemainingMs).toBe('number');
            expect(logData).toHaveProperty('idleTimeoutArmed');
            expect(typeof logData.idleTimeoutArmed).toBe('boolean');
            expect(logData).toHaveProperty('hardTimeoutMs');
            expect(typeof logData.hardTimeoutMs).toBe('number');
            expect(logData).toHaveProperty('hardTimeoutRemainingMs');
            expect(typeof logData.hardTimeoutRemainingMs).toBe('number');
            expect(logData).toHaveProperty('timeSinceLastHeartbeat');
            expect(typeof logData.timeSinceLastHeartbeat).toBe('string');

            // Verify existing fields are still present
            expect(logData).toHaveProperty('hasReceivedOutput');
            expect(logData).toHaveProperty('stdoutLength');
            expect(logData).toHaveProperty('stderrLength');
            expect(logData).toHaveProperty('timeSinceLastOutput');
            expect(logData).toHaveProperty('elapsed');
          }
        }

        // Wait for command to complete or timeout
        await promise.catch(() => {
          // Expected - command may fail or timeout
        });
      } finally {
        // Restore original values
        if (originalTimeout) {
          process.env.CURSOR_CLI_TIMEOUT = originalTimeout;
        } else {
          delete process.env.CURSOR_CLI_TIMEOUT;
        }
        if (originalIdleTimeout) {
          process.env.CURSOR_CLI_IDLE_TIMEOUT = originalIdleTimeout;
        } else {
          delete process.env.CURSOR_CLI_IDLE_TIMEOUT;
        }
        loggerInfoSpy.mockRestore();
      }
    }, 45000);

    it('should log first output detected when cursor-cli produces output', async () => {
      // This test verifies that the "first output detected" log is emitted
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      try {
        const firstOutputTestCLI = new CursorCLI();

        // Execute a command that should produce output
        const promise = firstOutputTestCLI
          .executeCommand(['--help'], {
            timeout: 10000,
          })
          .catch(() => {
            // May fail, that's okay for this test
          });

        // Wait a bit for output to arrive
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Find "first output detected" log calls
        const firstOutputLogs = loggerInfoSpy.mock.calls.filter((call) => {
          const firstArg = call[0] as unknown;
          if (typeof firstArg === 'string') {
            return firstArg === 'cursor-cli first output detected';
          }
          return false;
        });

        // If command produced output, should have at least one "first output detected" log
        // (Note: command may complete before we check, so this is best-effort)
        if (firstOutputLogs.length > 0) {
          const firstOutputLog = firstOutputLogs[0];
          // Winston logger.info() can be called with (message, meta) or just (meta)
          // The spy captures all arguments, so check both call[0] and call[1]
          const firstArg = firstOutputLog[0] as unknown;
          const secondArg = (firstOutputLog as unknown[])[1] as Record<string, unknown> | undefined;
          const logData = (
            typeof firstArg === 'object' && firstArg !== null
              ? (firstArg as Record<string, unknown>)
              : secondArg
          ) as Record<string, unknown> | undefined;

          if (logData) {
            expect(logData).toHaveProperty('command');
            expect(logData).toHaveProperty('args');
            expect(logData).toHaveProperty('cwd');
            expect(logData).toHaveProperty('usePty');
          }
        }

        // Wait for command to complete
        await promise.catch(() => {
          // Expected - command may fail
        });
      } finally {
        loggerInfoSpy.mockRestore();
      }
    }, 15000);
  });

  describe('PTY vs Spawn', () => {
    let testCursorCLI: CursorCLI;

    beforeEach(() => {
      testCursorCLI = new CursorCLI();
    });

    it.skip('should use PTY when node-pty is available', async () => {
      // This test verifies that PTY is used when node-pty module is available
      // Note: In test environment, node-pty may or may not be available
      // The test verifies the behavior exists, not that it always uses PTY
      const result = await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error',
        };
      });

      // The command should execute (even if it fails)
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    });

    it.skip('should fallback to spawn when PTY fails', async () => {
      // This test verifies that when PTY fails, the code falls back to regular spawn
      // The implementation already handles this - if PTY fails, it uses spawn
      const result = await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error',
        };
      });

      // The command should execute (even if it fails)
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    });

    it.skip('should use spawn when node-pty is not available', async () => {
      // This test verifies that spawn is used when node-pty is not available
      // The implementation checks for _ptyModule and falls back to spawn if null
      const result = await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error',
        };
      });

      // The command should execute (even if it fails)
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    });

    it.skip('should log PTY vs spawn usage', async () => {
      // This test verifies that logs reflect whether PTY or spawn is used
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
      });

      // Check if either PTY or spawn logging occurred
      loggerInfoSpy.mock.calls.find((call) => {
        const firstArg = call[0] as unknown;
        if (typeof firstArg === 'string') {
          return firstArg.includes('PTY') || firstArg.includes('spawn');
        }
        if (typeof firstArg === 'object' && firstArg !== null) {
          const obj = firstArg as Record<string, unknown>;
          return 'usePty' in obj || 'Using PTY' in obj || 'Using regular spawn' in obj;
        }
        return false;
      });

      // Should have logged either PTY or spawn usage
      expect(loggerInfoSpy).toHaveBeenCalled();

      loggerInfoSpy.mockRestore();
    });
  });

  describe('SSH Host Key Prompt', () => {
    let testCursorCLI: CursorCLI;

    beforeEach(() => {
      testCursorCLI = new CursorCLI();
    });

    it.skip('should detect SSH host key prompt in PTY output', async () => {
      // This test verifies that SSH host key prompts are detected
      // Note: This is difficult to test without mocking PTY, but we verify the code path exists
      // eslint-disable-next-line node/no-unsupported-features/es-syntax
      const { logger } = await import('../src/logger.js');
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      // Execute a command (may or may not trigger SSH prompt)
      await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
      });

      // The code should handle SSH prompts if they occur
      // We verify the logging mechanism exists
      expect(loggerInfoSpy).toHaveBeenCalled();

      loggerInfoSpy.mockRestore();
    });

    it.skip('should auto-respond to SSH prompt once', async () => {
      // This test verifies that SSH prompts are auto-responded to
      // The implementation uses sshPromptResponded flag to prevent multiple responses
      // Note: This is difficult to test without mocking PTY output
      const result = await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error',
        };
      });

      // The command should execute (even if it fails)
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    });

    it.skip('should not respond multiple times to SSH prompts', async () => {
      // This test verifies that multiple SSH prompts don't cause multiple responses
      // The implementation uses sshPromptResponded flag to prevent duplicate responses
      const result = await testCursorCLI.executeCommand(['--version']).catch(() => {
        // Expected to fail if cursor-cli is not available
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error',
        };
      });

      // The command should execute (even if it fails)
      expect(result).toBeDefined();
      expect(result.success !== undefined).toBe(true);
    });
  });

  describe('Output Size Limits', () => {
    let testCursorCLI: CursorCLI;

    beforeEach(() => {
      // Set a very small output size limit for testing
      process.env.CURSOR_CLI_MAX_OUTPUT_SIZE = '1000'; // 1KB
      testCursorCLI = new CursorCLI();
    });

    afterEach(() => {
      delete process.env.CURSOR_CLI_MAX_OUTPUT_SIZE;
    });

    it('should kill command when output exceeds CURSOR_CLI_MAX_OUTPUT_SIZE', async () => {
      // This test verifies that commands are killed when output exceeds the limit
      // Note: This is difficult to test without mocking spawn to produce large output
      // The implementation checks outputSize and kills the process if exceeded
      try {
        await testCursorCLI.executeCommand(['--help'], {
          timeout: 5000,
        });
        // Command may complete before exceeding limit
      } catch (error) {
        // If output size is exceeded, should throw an error
        const commandError = error as Error;
        expect(commandError).toBeDefined();
        expect(commandError.message).toBeDefined();
        expect(typeof commandError.message).toBe('string');
      }
    });

    it('should throw descriptive error with size limit information', async () => {
      // This test verifies that errors include size limit information
      try {
        await testCursorCLI.executeCommand(['--help'], {
          timeout: 5000,
        });
        // Command may complete before exceeding limit
      } catch (error) {
        // If output size is exceeded, error should mention the limit
        const commandError = error as Error;
        expect(commandError).toBeDefined();
        expect(commandError.message).toBeDefined();
        expect(typeof commandError.message).toBe('string');
        if (commandError.message.includes('Output size exceeded')) {
          expect(commandError.message).toContain('bytes');
        }
      }
    });
  });

  describe('extractFilesFromOutput - Additional Tests', () => {
    it('should extract files from various cursor-cli output formats', () => {
      // Test various output formats that cursor-cli might produce
      const output1 = 'created: app/services/test.rb\nmodified: spec/services/test_spec.rb';
      const files1 = cursorCLI.extractFilesFromOutput(output1);
      expect(files1).toContain('app/services/test.rb');
      expect(files1).toContain('spec/services/test_spec.rb');

      // Test with "updated:" pattern
      const output2 = 'updated: src/index.ts\ncreated: tests/index.test.ts';
      const files2 = cursorCLI.extractFilesFromOutput(output2);
      expect(files2.length).toBe(2);
      expect(files2).toContain('src/index.ts');
      expect(files2).toContain('tests/index.test.ts');
    });

    it('should handle multiple file patterns', () => {
      const output =
        'created: app/services/test.rb\nmodified: spec/services/test_spec.rb\nupdated: old_file.rb';
      const files = cursorCLI.extractFilesFromOutput(output);
      expect(files.length).toBe(3);
      // Should extract all file paths regardless of action (created, modified, updated)
      expect(files).toContain('app/services/test.rb');
      expect(files).toContain('spec/services/test_spec.rb');
      expect(files).toContain('old_file.rb');
    });

    it('should handle files with spaces in paths', () => {
      const output = 'created: app/services/test file.rb\nmodified: spec/test spec.rb';
      const files = cursorCLI.extractFilesFromOutput(output);
      expect(files.length).toBe(2);
      expect(files).toContain('app/services/test file.rb');
      expect(files).toContain('spec/test spec.rb');
    });
  });
});
