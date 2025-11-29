// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TargetAppRunner } from '../src/target-app.js';

// Mock dependencies before importing anything that uses them
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

describe.skip('TargetAppRunner', () => {
  let targetAppRunner: TargetAppRunner;
  let mockChild: any;
  let mockExistsSync: jest.Mock<(path: string) => boolean>;

  beforeEach(() => {
    mockExistsSync = jest.fn<(path: string) => boolean>().mockReturnValue(true);
    targetAppRunner = new TargetAppRunner({ fsExistsSync: mockExistsSync });

    // Create mock child process that stores event handlers synchronously
    const handlers = {
      stdout: [] as Array<(data: Buffer) => void>,
      stderr: [] as Array<(data: Buffer) => void>,
      close: [] as Array<(code: number) => void>,
      error: [] as Array<(error: Error) => void>,
    };

    mockChild = {
      stdout: {
        on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            handlers.stdout.push(cb);
          }
          return mockChild.stdout; // Chainable
        }),
      },
      stderr: {
        on: jest.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') {
            handlers.stderr.push(cb);
          }
          return mockChild.stderr; // Chainable
        }),
      },
      on: jest.fn((event: string, cb: (code: number | Error) => void) => {
        if (event === 'close') {
          handlers.close.push(cb as (code: number) => void);
        }
        if (event === 'error') {
          handlers.error.push(cb as (error: Error) => void);
        }
        return mockChild; // Chainable
      }),
      kill: jest.fn(),
      handlers,
    };

    // CRITICAL: Set mockSpawn to return mockChild AFTER creating mockChild
    // This ensures spawn() returns our instrumented mockChild
    mockSpawn.mockReturnValue(mockChild);
  });

  afterEach(() => {
    // Don't clear all mocks - it breaks the mock setup
    // Just clear call history for specific mocks
    mockSpawn.mockClear();
    if (mockExistsSync) mockExistsSync.mockClear();
    delete process.env.TARGET_APP_PATH;
    delete process.env.TARGET_APP_TYPE;
    delete process.env.TARGET_APP_TIMEOUT;
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const runner = new TargetAppRunner();
      expect(runner.targetAppPath).toBe('../cursor');
      expect(runner.targetAppType).toBe('rails');
      expect(runner.timeout).toBe(600000); // 10 minutes
    });

    it('should use environment variables for configuration', () => {
      process.env.TARGET_APP_PATH = '/custom/path';
      process.env.TARGET_APP_TYPE = 'node';
      process.env.TARGET_APP_TIMEOUT = '300000';

      const runner = new TargetAppRunner();
      expect(runner.targetAppPath).toBe('/custom/path');
      expect(runner.targetAppType).toBe('node');
      expect(runner.timeout).toBe(300000);
    });
  });

  describe('validate', () => {
    it('should validate successfully when path exists', async () => {
      mockExistsSync.mockReturnValue(true);

      const result = await targetAppRunner.validate();

      expect(result).toBe(true);
      expect(mockExistsSync).toHaveBeenCalledWith(targetAppRunner.targetAppPath);
    });

    it('should throw error when path does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(targetAppRunner.validate()).rejects.toThrow(
        `Target application path does not exist: ${targetAppRunner.targetAppPath}`
      );
    });
  });

  describe('runTests', () => {
    it('should run Rails tests successfully', async () => {
      // Create a fresh instance for this test (doesn't need fsExistsSync mock)
      const runner = new TargetAppRunner();
      const mockOutput = '10 examples, 0 failures';

      const promise = runner.runTests();

      // Simulate stdout data and successful close using stored handlers
      mockChild.handlers.stdout.forEach((handler: (data: Buffer) => void) =>
        handler(Buffer.from(mockOutput))
      );
      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(0));

      const result = (await promise) as any;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.passed.total).toBe(10);
      expect(mockSpawn).toHaveBeenCalledWith('bundle', ['exec', 'rspec'], {
        cwd: runner.targetAppPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should run Node tests successfully', async () => {
      process.env.TARGET_APP_TYPE = 'node';
      const runner = new TargetAppRunner();
      const mockOutput = '5 passed';

      const promise = runner.runTests();

      mockChild.handlers.stdout.forEach((handler: (data: Buffer) => void) =>
        handler(Buffer.from(mockOutput))
      );
      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(0));

      const result = (await promise) as any;

      expect(result.success).toBe(true);
      expect(result.passed.passed).toBe(5);
      expect(mockSpawn).toHaveBeenCalledWith('npm', ['test'], {
        cwd: runner.targetAppPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle test failures', async () => {
      const mockOutput = '10 examples, 2 failures';
      const mockStderr = 'Test failures occurred';

      const promise = targetAppRunner.runTests();

      mockChild.handlers.stdout.forEach((handler: (data: Buffer) => void) =>
        handler(Buffer.from(mockOutput))
      );
      mockChild.handlers.stderr.forEach((handler: (data: Buffer) => void) =>
        handler(Buffer.from(mockStderr))
      );
      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(1));

      const result = (await promise) as any;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.passed.total).toBe(10);
      expect(result.passed.failed).toBe(2);
      expect(result.error).toBe(mockStderr);
    });

    it('should use custom target path', async () => {
      const customPath = '/custom/app/path';

      const promise = targetAppRunner.runTests(customPath);

      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(0));

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('bundle', ['exec', 'rspec'], {
        cwd: customPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should throw error for unsupported app type', async () => {
      process.env.TARGET_APP_TYPE = 'unsupported';
      const runner = new TargetAppRunner();

      const result = (await runner.runTests()) as any;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported target app type: unsupported');
    });

    it('should handle command execution errors', async () => {
      const errorMessage = 'Command not found';
      const promise = targetAppRunner.runTests();

      mockChild.handlers.error.forEach((handler: (error: Error) => void) =>
        handler(new Error(errorMessage))
      );

      const result = (await promise) as any;

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
    });
  });

  describe('executeCommand', () => {
    // Helper to get handlers from mock calls (more reliable than handlers array)
    const getHandlers = () => {
      const stdoutOnCalls = mockChild.stdout.on.mock.calls;
      const stderrOnCalls = mockChild.stderr.on.mock.calls;
      const onCalls = mockChild.on.mock.calls;

      return {
        stdout: stdoutOnCalls.find((call: any) => call[0] === 'data')?.[1] as
          | ((data: Buffer) => void)
          | undefined,
        stderr: stderrOnCalls.find((call: any) => call[0] === 'data')?.[1] as
          | ((data: Buffer) => void)
          | undefined,
        close: onCalls.find((call: any) => call[0] === 'close')?.[1] as
          | ((code: number) => void)
          | undefined,
        error: onCalls.find((call: any) => call[0] === 'error')?.[1] as
          | ((error: Error) => void)
          | undefined,
      };
    };

    it('should execute command successfully', async () => {
      const mockStdout = 'Command output';

      const promise = targetAppRunner.executeCommand('bundle', ['exec', 'rake']);

      // Verify spawn was called and returned mockChild
      expect(mockSpawn).toHaveBeenCalled();
      const spawnResult = mockSpawn.mock.results[0]?.value;
      expect(spawnResult).toBe(mockChild);

      // Handlers are registered synchronously - get them from mock call history
      const handlers = getHandlers();

      // If handlers aren't in call history, they should be in the handlers array
      if (!handlers.stdout || !handlers.close) {
        expect(mockChild.handlers.stdout.length).toBeGreaterThan(0);
        expect(mockChild.handlers.close.length).toBeGreaterThan(0);
        mockChild.handlers.stdout.forEach((h: (data: Buffer) => void) =>
          h(Buffer.from(mockStdout))
        );
        mockChild.handlers.close.forEach((h: (code: number) => void) => h(0));
      } else {
        handlers.stdout(Buffer.from(mockStdout));
        handlers.close(0);
      }

      const result = (await promise) as any;

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(mockStdout);
      expect(mockSpawn).toHaveBeenCalledWith('bundle', ['exec', 'rake'], {
        cwd: targetAppRunner.targetAppPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle command with non-zero exit code', async () => {
      const mockStderr = 'Error output';

      const promise = targetAppRunner.executeCommand('bundle', ['exec', 'rake', 'invalid']);

      mockChild.handlers.stderr.forEach((handler: (data: Buffer) => void) =>
        handler(Buffer.from(mockStderr))
      );
      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(1));

      const result = (await promise) as any;

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(mockStderr);
    });

    it('should use custom working directory', async () => {
      const customCwd = '/custom/path';

      const promise = targetAppRunner.executeCommand('bundle', ['exec', 'rake'], {
        cwd: customCwd,
      });

      mockChild.handlers.close.forEach((handler: (code: number) => void) => handler(0));

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('bundle', ['exec', 'rake'], {
        cwd: customCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle command timeout', async () => {
      jest.useFakeTimers();

      const promise = targetAppRunner.executeCommand('bundle', ['exec', 'rake'], {
        timeout: 100,
      });

      jest.advanceTimersByTime(101);

      await expect(promise).rejects.toThrow('Command timeout after 100ms');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should handle process spawn errors', async () => {
      const spawnError = new Error('spawn nonexistent ENOENT');
      mockSpawn.mockImplementation(() => {
        throw spawnError;
      });

      await expect(targetAppRunner.executeCommand('nonexistent', [])).rejects.toThrow(
        'spawn nonexistent ENOENT'
      );
    });

    it('should handle process error events', async () => {
      const processError = new Error('Process error');

      const promise = targetAppRunner.executeCommand('test', []);

      // Error handler should be registered synchronously
      expect(mockChild.handlers.error.length).toBeGreaterThan(0);

      mockChild.handlers.error.forEach((handler: (error: Error) => void) => handler(processError));

      await expect(promise).rejects.toThrow('Process error');
    });
  });

  describe('extractTestResults', () => {
    it('should extract RSpec test results', () => {
      const output = '10 examples, 2 failures';
      const results = targetAppRunner.extractTestResults(output, false) as any;

      expect(results.total).toBe(10);
      expect(results.failed).toBe(2);
      expect(results.passed).toBe(8);
      expect(results.success).toBe(false);
    });

    it('should extract RSpec results with singular forms', () => {
      const output = '1 example, 1 failure';
      const results = targetAppRunner.extractTestResults(output, false) as any;

      expect(results.total).toBe(1);
      expect(results.failed).toBe(1);
      expect(results.passed).toBe(0);
    });

    it('should extract Jest test results', () => {
      const output = '5 passed';
      const results = targetAppRunner.extractTestResults(output, true) as any;

      expect(results.passed).toBe(5);
      expect(results.success).toBe(true);
    });

    it('should handle empty output', () => {
      const results = targetAppRunner.extractTestResults('', true) as any;

      expect(results.total).toBe(0);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(0);
      expect(results.success).toBe(true);
    });

    it('should handle output with no test results', () => {
      const output = 'Some other output without test results';
      const results = targetAppRunner.extractTestResults(output, true) as any;

      expect(results.total).toBe(0);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(0);
    });

    it('should handle RSpec results with all passing', () => {
      const output = '10 examples, 0 failures';
      const results = targetAppRunner.extractTestResults(output, true) as any;

      expect(results.total).toBe(10);
      expect(results.failed).toBe(0);
      expect(results.passed).toBe(10);
    });
  });
});
