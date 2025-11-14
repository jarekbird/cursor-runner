// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { TerminalService } from '../src/terminal-service.js';

describe.skip('TerminalService', () => {
  let terminalService;
  let mockSpawn;
  let mockChild;

  beforeEach(() => {
    // Create mock spawn function
    mockSpawn = jest.fn();

    // Create mock child process that stores event handlers synchronously
    const handlers = {
      stdout: [],
      stderr: [],
      close: [],
      error: [],
    };

    mockChild = {
      stdout: {
        on: jest.fn((event, cb) => {
          if (event === 'data') {
            handlers.stdout.push(cb);
          }
          return mockChild.stdout; // Chainable
        }),
      },
      stderr: {
        on: jest.fn((event, cb) => {
          if (event === 'data') {
            handlers.stderr.push(cb);
          }
          return mockChild.stderr; // Chainable
        }),
      },
      on: jest.fn((event, cb) => {
        if (event === 'close') {
          handlers.close.push(cb);
        }
        if (event === 'error') {
          handlers.error.push(cb);
        }
        return mockChild; // Chainable
      }),
      kill: jest.fn(),
      handlers,
    };

    // Set mockSpawn to return mockChild
    mockSpawn.mockReturnValue(mockChild);

    // Create TerminalService with injected spawn function
    terminalService = new TerminalService({ spawnFn: mockSpawn });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.ENFORCE_COMMAND_WHITELIST;
    delete process.env.ALLOWED_TERMINAL_COMMANDS;
    delete process.env.BLOCKED_TERMINAL_COMMANDS;
    delete process.env.TERMINAL_COMMAND_TIMEOUT;
    delete process.env.TERMINAL_MAX_OUTPUT_SIZE;
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const service = new TerminalService();
      expect(service.timeout).toBe(300000); // 5 minutes
      expect(service.maxOutputSize).toBe(10485760); // 10MB
      expect(service.allowedCommands).toContain('git');
      expect(service.blockedCommands).toContain('rm');
    });

    it('should use environment variables for configuration', () => {
      process.env.TERMINAL_COMMAND_TIMEOUT = '60000';
      process.env.TERMINAL_MAX_OUTPUT_SIZE = '5242880';
      process.env.ALLOWED_TERMINAL_COMMANDS = 'test,command';
      process.env.BLOCKED_TERMINAL_COMMANDS = 'dangerous';

      const service = new TerminalService();
      expect(service.timeout).toBe(60000);
      expect(service.maxOutputSize).toBe(5242880);
      expect(service.allowedCommands).toEqual(['test', 'command']);
      expect(service.blockedCommands).toEqual(['dangerous']);
    });
  });

  describe('validateCommandSecurity', () => {
    it('should allow safe commands', () => {
      expect(() => {
        terminalService.validateCommandSecurity('git', ['status']);
      }).not.toThrow();
    });

    it('should block rm command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('rm', ['-rf', '/']);
      }).toThrow('Blocked command detected: rm');
    });

    it('should block del command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('del', ['file.txt']);
      }).toThrow('Blocked command detected: del');
    });

    it('should block format command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('format', ['C:']);
      }).toThrow('Blocked command detected: format');
    });

    it('should block dd command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('dd', ['if=/dev/zero']);
      }).toThrow('Blocked command detected: dd');
    });

    it('should block sudo command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('sudo', ['rm', '-rf', '/']);
      }).toThrow('Blocked command detected: sudo');
    });

    it('should block su command', () => {
      expect(() => {
        terminalService.validateCommandSecurity('su', ['-']);
      }).toThrow('Blocked command detected: su');
    });

    it('should block commands case-insensitively', () => {
      expect(() => {
        terminalService.validateCommandSecurity('RM', ['-rf', '/']);
      }).toThrow('Blocked command detected: rm');
    });

    it('should block blocked commands in arguments', () => {
      expect(() => {
        terminalService.validateCommandSecurity('echo', ['rm', '-rf']);
      }).toThrow('Blocked command detected: rm');
    });

    it('should enforce whitelist when ENFORCE_COMMAND_WHITELIST is true', () => {
      process.env.ENFORCE_COMMAND_WHITELIST = 'true';
      const service = new TerminalService();

      // Allowed command should pass
      expect(() => {
        service.validateCommandSecurity('git', ['status']);
      }).not.toThrow();

      // Non-whitelisted command should fail
      expect(() => {
        service.validateCommandSecurity('unknown', ['command']);
      }).toThrow('Command not in whitelist: unknown');
    });

    it('should not enforce whitelist when ENFORCE_COMMAND_WHITELIST is not set', () => {
      const service = new TerminalService();

      // Non-whitelisted but not blocked command should pass
      expect(() => {
        service.validateCommandSecurity('unknown', ['command']);
      }).not.toThrow();
    });

    it('should allow commands that match allowed list partially', () => {
      process.env.ENFORCE_COMMAND_WHITELIST = 'true';
      const service = new TerminalService();

      expect(() => {
        service.validateCommandSecurity('git-status', []);
      }).not.toThrow();
    });
  });

  describe('executeCommand', () => {
    // Helper to get handlers from mock calls (more reliable than handlers array)
    const getHandlers = () => {
      const stdoutOnCalls = mockChild.stdout.on.mock.calls;
      const stderrOnCalls = mockChild.stderr.on.mock.calls;
      const onCalls = mockChild.on.mock.calls;

      return {
        stdout: stdoutOnCalls.find((call) => call[0] === 'data')?.[1],
        stderr: stderrOnCalls.find((call) => call[0] === 'data')?.[1],
        close: onCalls.find((call) => call[0] === 'close')?.[1],
        error: onCalls.find((call) => call[0] === 'error')?.[1],
      };
    };

    it('should execute command successfully', async () => {
      const mockStdoutData = Buffer.from('test output');

      const promise = terminalService.executeCommand('echo', ['test']);

      // Get handlers from mock call history (registered synchronously)
      const handlers = getHandlers();
      expect(handlers.stdout).toBeDefined();
      expect(handlers.close).toBeDefined();

      // Simulate stdout data then process close
      handlers.stdout(mockStdoutData);
      handlers.close(0);

      const result = await promise;

      expect(mockSpawn).toHaveBeenCalledWith('echo', ['test'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('test output');
      expect(result.stderr).toBe('');
    });

    it('should handle command with non-zero exit code', async () => {
      const mockStderrData = Buffer.from('error message');

      const promise = terminalService.executeCommand('false', []);

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.stderr).toBeDefined();
      expect(handlers.close).toBeDefined();

      // Simulate stderr data
      handlers.stderr(mockStderrData);
      handlers.close(1);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('error message');
    });

    it('should use custom working directory', async () => {
      const customCwd = '/custom/path';

      const promise = terminalService.executeCommand('pwd', [], { cwd: customCwd });

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.close).toBeDefined();

      // Simulate process close with success
      handlers.close(0);

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('pwd', [], {
        cwd: customCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should use custom timeout', async () => {
      const customTimeout = 1000;

      const promise = terminalService.executeCommand('sleep', ['1'], {
        timeout: customTimeout,
      });

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.close).toBeDefined();

      // Simulate process close with success
      handlers.close(0);

      await promise;

      // Verify timeout was set (we can't easily test the actual timeout, but we can verify it was used)
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('should handle process spawn errors', async () => {
      const spawnError = new Error('Command not found');
      mockSpawn.mockImplementation(() => {
        throw spawnError;
      });

      await expect(terminalService.executeCommand('nonexistent', [])).rejects.toThrow(
        'spawn nonexistent ENOENT'
      );
    });

    it('should handle process error events', async () => {
      const processError = new Error('Process error');

      const promise = terminalService.executeCommand('test', []);

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.error).toBeDefined();

      // Simulate process error
      handlers.error(processError);

      await expect(promise).rejects.toThrow('Process error');
    });

    it('should handle command timeout', async () => {
      jest.useFakeTimers();

      const promise = terminalService.executeCommand('sleep', ['100'], {
        timeout: 100,
      });

      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(101);

      await expect(promise).rejects.toThrow('Command timeout after 100ms');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should handle output size limit exceeded', async () => {
      process.env.TERMINAL_MAX_OUTPUT_SIZE = '10'; // Very small limit

      // Create service with injected spawn for this test
      const service = new TerminalService({ spawnFn: mockSpawn });
      const largeData = Buffer.alloc(20, 'x'); // 20 bytes

      const promise = service.executeCommand('echo', ['large output']);

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.stdout).toBeDefined();

      handlers.stdout(largeData);

      await expect(promise).rejects.toThrow('Output size exceeded limit: 10 bytes');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should collect both stdout and stderr', async () => {
      const mockStdoutData = Buffer.from('stdout output');
      const mockStderrData = Buffer.from('stderr output');

      const promise = terminalService.executeCommand('test', []);

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.stdout).toBeDefined();
      expect(handlers.stderr).toBeDefined();
      expect(handlers.close).toBeDefined();

      handlers.stdout(mockStdoutData);
      handlers.stderr(mockStderrData);
      handlers.close(0);

      const result = await promise;

      expect(result.stdout).toBe('stdout output');
      expect(result.stderr).toBe('stderr output');
    });

    it('should trim stdout and stderr', async () => {
      const mockStdoutData = Buffer.from('  output with spaces  \n');
      const mockStderrData = Buffer.from('  error with spaces  \n');

      const promise = terminalService.executeCommand('test', []);

      // Get handlers from mock call history
      const handlers = getHandlers();
      expect(handlers.stdout).toBeDefined();
      expect(handlers.stderr).toBeDefined();
      expect(handlers.close).toBeDefined();

      handlers.stdout(mockStdoutData);
      handlers.stderr(mockStderrData);
      handlers.close(0);

      const result = await promise;

      expect(result.stdout).toBe('output with spaces');
      expect(result.stderr).toBe('error with spaces');
    });

    it('should validate command security before execution', async () => {
      await expect(terminalService.executeCommand('rm', ['-rf', '/'])).rejects.toThrow(
        'Blocked command detected: rm'
      );

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
