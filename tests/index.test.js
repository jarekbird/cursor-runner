// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorRunner } from '../src/index.js';

describe('CursorRunner', () => {
  let cursorRunner;
  let originalEnv;
  let mockCursorCLI;
  let mockTargetAppRunner;
  let mockServer;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.CURSOR_CLI_PATH = 'cursor';
    process.env.TARGET_APP_PATH = '/path/to/app';

    // Suppress console.error and process.exit to prevent test failures
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => {});

    // Create mock instances using dependency injection
    mockCursorCLI = {
      validate: jest.fn().mockResolvedValue(true),
      generateTests: jest.fn().mockResolvedValue({ success: true, files: [] }),
      generateImplementation: jest.fn().mockResolvedValue({ success: true, files: [] }),
      refactorCode: jest.fn().mockResolvedValue({ success: true, files: [] }),
    };

    mockTargetAppRunner = {
      runTests: jest.fn().mockResolvedValue({ success: true, output: 'Tests passed' }),
    };

    mockServer = {
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue(),
      port: 3001,
    };

    cursorRunner = new CursorRunner({
      cursorCLI: mockCursorCLI,
      targetAppRunner: mockTargetAppRunner,
      server: mockServer,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with required services', () => {
      expect(cursorRunner.cursorCLI).toBe(mockCursorCLI);
      expect(cursorRunner.targetAppRunner).toBe(mockTargetAppRunner);
      expect(cursorRunner.server).toBe(mockServer);
      expect(cursorRunner.logger).toBeDefined();
    });
  });

  describe('validateConfig', () => {
    it('should throw error when CURSOR_CLI_PATH is missing', () => {
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI,
        targetAppRunner: mockTargetAppRunner,
        server: mockServer,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');
    });

    it('should throw error when TARGET_APP_PATH is missing', () => {
      delete process.env.TARGET_APP_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI,
        targetAppRunner: mockTargetAppRunner,
        server: mockServer,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: TARGET_APP_PATH');
    });

    it('should throw error when multiple variables are missing', () => {
      delete process.env.CURSOR_CLI_PATH;
      delete process.env.TARGET_APP_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI,
        targetAppRunner: mockTargetAppRunner,
        server: mockServer,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH, TARGET_APP_PATH');
    });

    it('should not throw when all required variables are present', () => {
      process.env.CURSOR_CLI_PATH = 'cursor';
      process.env.TARGET_APP_PATH = '/path/to/app';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI,
        targetAppRunner: mockTargetAppRunner,
        server: mockServer,
      });

      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await cursorRunner.initialize();

      expect(cursorRunner.cursorCLI.validate).toHaveBeenCalled();
      expect(cursorRunner.server.start).toHaveBeenCalled();
    });

    it('should throw error when cursor CLI validation fails', async () => {
      cursorRunner.cursorCLI.validate.mockRejectedValue(new Error('Cursor CLI not found'));

      await expect(cursorRunner.initialize()).rejects.toThrow('Cursor CLI not found');
    });

    it('should throw error when server start fails', async () => {
      cursorRunner.server.start.mockRejectedValue(new Error('Port already in use'));

      await expect(cursorRunner.initialize()).rejects.toThrow('Port already in use');
    });

    it('should throw error when config validation fails', async () => {
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI,
        targetAppRunner: mockTargetAppRunner,
        server: mockServer,
      });

      await expect(runner.initialize()).rejects.toThrow('Missing required environment variables');
    });
  });

  describe('shutdown', () => {
    it('should shutdown successfully', async () => {
      await cursorRunner.shutdown();

      expect(cursorRunner.server.stop).toHaveBeenCalled();
    });

    it('should handle shutdown errors gracefully', async () => {
      cursorRunner.server.stop.mockRejectedValue(new Error('Shutdown error'));

      // Should not throw
      await expect(cursorRunner.shutdown()).resolves.not.toThrow();
    });
  });

  describe('executeCodeGeneration', () => {
    it('should execute red phase (test generation)', async () => {
      const request = {
        id: 'test-123',
        phase: 'red',
        requirements: { description: 'Test feature' },
        targetPath: '/path/to/app',
      };

      const result = await cursorRunner.executeCodeGeneration(request);

      expect(cursorRunner.cursorCLI.generateTests).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath
      );
      expect(result.success).toBe(true);
    });

    it('should execute green phase (implementation generation)', async () => {
      const request = {
        id: 'test-123',
        phase: 'green',
        requirements: { description: 'Test feature' },
        targetPath: '/path/to/app',
      };

      const result = await cursorRunner.executeCodeGeneration(request);

      expect(cursorRunner.cursorCLI.generateImplementation).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath
      );
      expect(result.success).toBe(true);
    });

    it('should execute refactor phase', async () => {
      const request = {
        id: 'test-123',
        phase: 'refactor',
        requirements: { description: 'Refactor code' },
        targetPath: '/path/to/app',
      };

      const result = await cursorRunner.executeCodeGeneration(request);

      expect(cursorRunner.cursorCLI.refactorCode).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath
      );
      expect(result.success).toBe(true);
    });

    it('should execute validate phase (test execution)', async () => {
      const request = {
        id: 'test-123',
        phase: 'validate',
        requirements: { description: 'Validate code' },
        targetPath: '/path/to/app',
      };

      const result = await cursorRunner.executeCodeGeneration(request);

      expect(cursorRunner.targetAppRunner.runTests).toHaveBeenCalledWith(request.targetPath);
      expect(result.success).toBe(true);
    });

    it('should throw error for unknown phase', async () => {
      const request = {
        id: 'test-123',
        phase: 'unknown',
        requirements: { description: 'Test' },
        targetPath: '/path/to/app',
      };

      await expect(cursorRunner.executeCodeGeneration(request)).rejects.toThrow(
        'Unknown phase: unknown'
      );
    });

    it('should handle errors during code generation', async () => {
      const request = {
        id: 'test-123',
        phase: 'red',
        requirements: { description: 'Test feature' },
        targetPath: '/path/to/app',
      };

      cursorRunner.cursorCLI.generateTests.mockRejectedValue(new Error('Generation failed'));

      await expect(cursorRunner.executeCodeGeneration(request)).rejects.toThrow(
        'Generation failed'
      );
    });

    it('should include duration and files count in result', async () => {
      const request = {
        id: 'test-123',
        phase: 'red',
        requirements: { description: 'Test feature' },
        targetPath: '/path/to/app',
      };

      cursorRunner.cursorCLI.generateTests.mockResolvedValue({
        success: true,
        files: ['file1.js', 'file2.js'],
      });

      const result = await cursorRunner.executeCodeGeneration(request);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('files');
      expect(result.files).toHaveLength(2);
    });
  });
});
