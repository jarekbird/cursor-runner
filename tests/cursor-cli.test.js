// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorCLI } from '../src/cursor-cli.js';

// Mock child_process before importing anything that uses it
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args) => mockSpawn(...args),
}));

// eslint-disable-next-line no-unused-vars
import { spawn } from 'child_process';

describe.skip('CursorCLI', () => {
  let cursorCLI;
  let mockChild;

  beforeEach(() => {
    cursorCLI = new CursorCLI();
    mockChild = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
    };
    mockSpawn.mockReturnValue(mockChild);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.CURSOR_CLI_PATH;
    delete process.env.CURSOR_CLI_TIMEOUT;
    delete process.env.CURSOR_CLI_MAX_OUTPUT_SIZE;
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const cli = new CursorCLI();
      expect(cli.cursorPath).toBe('cursor');
      expect(cli.timeout).toBe(300000); // 5 minutes
      expect(cli.maxOutputSize).toBe(10485760); // 10MB
    });

    it('should use environment variables for configuration', () => {
      process.env.CURSOR_CLI_PATH = '/custom/path/cursor';
      process.env.CURSOR_CLI_TIMEOUT = '60000';
      process.env.CURSOR_CLI_MAX_OUTPUT_SIZE = '5242880';

      const cli = new CursorCLI();
      expect(cli.cursorPath).toBe('/custom/path/cursor');
      expect(cli.timeout).toBe(60000);
      expect(cli.maxOutputSize).toBe(5242880);
    });
  });

  describe('validate', () => {
    it('should validate cursor-cli is available', async () => {
      const mockStdoutData = Buffer.from('cursor-cli version 1.0.0');

      let stdoutOnData;
      let closeHandler;

      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.validate();

      if (stdoutOnData) {
        stdoutOnData(mockStdoutData);
      }

      if (closeHandler) {
        closeHandler(0);
      }

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should throw error when cursor-cli validation fails', async () => {
      let errorHandler;
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      const promise = cursorCLI.validate();

      if (errorHandler) {
        errorHandler(new Error('Command not found'));
      }

      await expect(promise).rejects.toThrow('cursor-cli not available');
    });
  });

  describe('validateCommandSecurity', () => {
    it('should block dangerous commands', () => {
      expect(() => {
        cursorCLI.validateCommandSecurity(['rm', '-rf', '/']);
      }).toThrow('Blocked command detected');
    });

    it('should allow safe commands', () => {
      expect(() => {
        cursorCLI.validateCommandSecurity(['test']);
      }).not.toThrow();
    });
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const mockStdoutData = Buffer.from('Command output');

      let stdoutOnData;
      let closeHandler;

      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.executeCommand(['--version']);

      if (stdoutOnData) {
        stdoutOnData(mockStdoutData);
      }

      if (closeHandler) {
        closeHandler(0);
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('Command output');
      expect(mockSpawn).toHaveBeenCalledWith('cursor', ['--version'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle command with non-zero exit code', async () => {
      const mockStderrData = Buffer.from('Error message');

      let stderrOnData;
      let closeHandler;

      mockChild.stderr.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stderrOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.executeCommand(['invalid']);

      if (stderrOnData) {
        stderrOnData(mockStderrData);
      }

      if (closeHandler) {
        closeHandler(1);
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Error message');
    });

    it('should use custom working directory', async () => {
      const customCwd = '/custom/path';

      let closeHandler;
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.executeCommand(['generate'], { cwd: customCwd });

      if (closeHandler) {
        closeHandler(0);
      }

      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('cursor', ['generate'], {
        cwd: customCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    });

    it('should handle command timeout', async () => {
      jest.useFakeTimers();

      mockChild.on.mockImplementation(() => {
        // Handler for close event
      });

      const promise = cursorCLI.executeCommand(['long-running'], { timeout: 100 });

      jest.advanceTimersByTime(101);

      await expect(promise).rejects.toThrow('Command timeout after 100ms');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should handle output size limit exceeded', async () => {
      process.env.CURSOR_CLI_MAX_OUTPUT_SIZE = '10';
      const cli = new CursorCLI();
      const largeData = Buffer.alloc(20, 'x');

      let stdoutOnData;
      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      const promise = cli.executeCommand(['generate']);

      if (stdoutOnData) {
        stdoutOnData(largeData);
      }

      await expect(promise).rejects.toThrow('Output size exceeded limit: 10 bytes');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle process spawn errors', async () => {
      const spawnError = new Error('Command not found');
      mockSpawn.mockImplementation(() => {
        throw spawnError;
      });

      await expect(cursorCLI.executeCommand(['test'])).rejects.toThrow('Command not found');
    });

    it('should validate command security before execution', async () => {
      await expect(cursorCLI.executeCommand(['rm', '-rf', '/'])).rejects.toThrow(
        'Blocked command detected'
      );

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('generateTests', () => {
    it('should generate tests successfully', async () => {
      const requirements = { description: 'Test feature' };
      const targetPath = '/path/to/app';
      const mockOutput = 'created: spec/test_spec.rb';

      let stdoutOnData;
      let closeHandler;

      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.generateTests(requirements, targetPath);

      if (stdoutOnData) {
        stdoutOnData(Buffer.from(mockOutput));
      }

      if (closeHandler) {
        closeHandler(0);
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('red');
      expect(result.files).toContain('spec/test_spec.rb');
    });

    it('should handle test generation errors', async () => {
      const requirements = { description: 'Test feature' };
      const targetPath = '/path/to/app';

      let errorHandler;
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      const promise = cursorCLI.generateTests(requirements, targetPath);

      if (errorHandler) {
        errorHandler(new Error('Generation failed'));
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.phase).toBe('red');
      expect(result.error).toBe('Generation failed');
    });
  });

  describe('generateImplementation', () => {
    it('should generate implementation successfully', async () => {
      const requirements = { description: 'Implement feature' };
      const targetPath = '/path/to/app';
      const mockOutput = 'created: app/services/feature.rb';

      let stdoutOnData;
      let closeHandler;

      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.generateImplementation(requirements, targetPath);

      if (stdoutOnData) {
        stdoutOnData(Buffer.from(mockOutput));
      }

      if (closeHandler) {
        closeHandler(0);
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('green');
      expect(result.files).toContain('app/services/feature.rb');
    });

    it('should handle implementation generation errors', async () => {
      const requirements = { description: 'Implement feature' };
      const targetPath = '/path/to/app';

      let errorHandler;
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      const promise = cursorCLI.generateImplementation(requirements, targetPath);

      if (errorHandler) {
        errorHandler(new Error('Implementation failed'));
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.phase).toBe('green');
      expect(result.error).toBe('Implementation failed');
    });
  });

  describe('refactorCode', () => {
    it('should refactor code successfully', async () => {
      const requirements = { description: 'Refactor code' };
      const targetPath = '/path/to/app';
      const mockOutput = 'modified: app/services/feature.rb';

      let stdoutOnData;
      let closeHandler;

      mockChild.stdout.on.mockImplementation((event, handler) => {
        if (event === 'data') {
          stdoutOnData = handler;
        }
      });

      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'close') {
          closeHandler = handler;
        }
      });

      const promise = cursorCLI.refactorCode(requirements, targetPath);

      if (stdoutOnData) {
        stdoutOnData(Buffer.from(mockOutput));
      }

      if (closeHandler) {
        closeHandler(0);
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.phase).toBe('refactor');
      expect(result.files).toContain('app/services/feature.rb');
    });

    it('should handle refactoring errors', async () => {
      const requirements = { description: 'Refactor code' };
      const targetPath = '/path/to/app';

      let errorHandler;
      mockChild.on.mockImplementation((event, handler) => {
        if (event === 'error') {
          errorHandler = handler;
        }
      });

      const promise = cursorCLI.refactorCode(requirements, targetPath);

      if (errorHandler) {
        errorHandler(new Error('Refactoring failed'));
      }

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.phase).toBe('refactor');
      expect(result.error).toBe('Refactoring failed');
    });
  });

  describe('extractFilesFromOutput', () => {
    it('should extract file paths from output', () => {
      const output = 'created: app/services/test.rb\nmodified: spec/services/test_spec.rb';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toContain('app/services/test.rb');
      expect(files).toContain('spec/services/test_spec.rb');
    });

    it('should extract updated files', () => {
      const output = 'updated: app/models/user.rb';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toContain('app/models/user.rb');
    });

    it('should handle case-insensitive matching', () => {
      const output = 'CREATED: app/test.rb\nMODIFIED: spec/test_spec.rb';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toContain('app/test.rb');
      expect(files).toContain('spec/test_spec.rb');
    });

    it('should return empty array when no files found', () => {
      const output = 'No files created';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toEqual([]);
    });

    it('should handle empty output', () => {
      const files = cursorCLI.extractFilesFromOutput('');

      expect(files).toEqual([]);
    });

    it('should handle multiple files with various formats', () => {
      const output = `created: app/services/user.rb
modified: app/controllers/users_controller.rb
updated: app/models/user.rb
created: spec/services/user_spec.rb`;
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toHaveLength(4);
      expect(files).toContain('app/services/user.rb');
      expect(files).toContain('app/controllers/users_controller.rb');
      expect(files).toContain('app/models/user.rb');
      expect(files).toContain('spec/services/user_spec.rb');
    });
  });
});
