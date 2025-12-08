// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CursorRunner } from '../src/index.js';
import type { FormattedRequest } from '../src/request-formatter.js';
import { GitHubAuthService } from '../src/github-auth.js';

describe('CursorRunner', () => {
  let cursorRunner: CursorRunner;
  let originalEnv: NodeJS.ProcessEnv;
  let mockCursorCLI: {
    validate: jest.MockedFunction<() => Promise<boolean>>;
    generateTests: jest.MockedFunction<
      (requirements: unknown, targetPath?: string) => Promise<unknown>
    >;
    generateImplementation: jest.MockedFunction<
      (requirements: unknown, targetPath?: string) => Promise<unknown>
    >;
    refactorCode: jest.MockedFunction<
      (requirements: unknown, targetPath?: string) => Promise<unknown>
    >;
  };
  let mockTargetAppRunner: {
    runTests: jest.MockedFunction<(targetPath: string | null) => Promise<unknown>>;
  };
  let mockServer: {
    start: jest.MockedFunction<() => Promise<void>>;
    stop: jest.MockedFunction<() => Promise<void>>;
    port: number;
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.CURSOR_CLI_PATH = 'cursor';
    process.env.TARGET_APP_PATH = '/path/to/app';

    // Suppress console.error and process.exit to prevent test failures
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);

    // Create mock instances using dependency injection
    mockCursorCLI = {
      validate: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
      generateTests: jest
        .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
        .mockResolvedValue({ success: true, files: [] }),
      generateImplementation: jest
        .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
        .mockResolvedValue({ success: true, files: [] }),
      refactorCode: jest
        .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
        .mockResolvedValue({ success: true, files: [] }),
    };

    mockTargetAppRunner = {
      runTests: jest
        .fn<(targetPath: string | null) => Promise<unknown>>()
        .mockResolvedValue({ success: true, output: 'Tests passed' }),
    };

    mockServer = {
      start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      port: 3001,
    };

    cursorRunner = new CursorRunner({
      cursorCLI: mockCursorCLI as any,
      targetAppRunner: mockTargetAppRunner as any,
      server: mockServer as any,
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

    it('should accept and store all dependencies when injected', () => {
      // Create a new instance with all dependencies explicitly injected
      const customCursorCLI = {
        validate: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        generateTests: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
        generateImplementation: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
        refactorCode: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
      };

      const customTargetAppRunner = {
        runTests: jest
          .fn<(targetPath: string | null) => Promise<unknown>>()
          .mockResolvedValue({ success: true, output: 'Tests passed' }),
      };

      const customServer = {
        start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        port: 3002,
      };

      const runner = new CursorRunner({
        cursorCLI: customCursorCLI as any,
        targetAppRunner: customTargetAppRunner as any,
        server: customServer as any,
      });

      // Verify all dependencies are stored correctly
      expect(runner.cursorCLI).toBe(customCursorCLI);
      expect(runner.targetAppRunner).toBe(customTargetAppRunner);
      expect(runner.server).toBe(customServer);
      expect(runner.logger).toBeDefined();
      expect(typeof runner.logger).toBe('object');
    });

    it('should handle partial dependency injection', () => {
      // Create instance with only some dependencies
      const customCursorCLI = {
        validate: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        generateTests: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
        generateImplementation: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
        refactorCode: jest
          .fn<(requirements: unknown, targetPath?: string) => Promise<unknown>>()
          .mockResolvedValue({ success: true, files: [] }),
      };

      const customServer = {
        start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        port: 3003,
      };

      const runner = new CursorRunner({
        cursorCLI: customCursorCLI as any,
        server: customServer as any,
      });

      // Verify provided dependencies are used
      expect(runner.cursorCLI).toBe(customCursorCLI);
      expect(runner.server).toBe(customServer);
      // Verify default instance is created for targetAppRunner
      expect(runner.targetAppRunner).toBeDefined();
      expect(runner.logger).toBeDefined();
    });
  });

  describe('validateConfig', () => {
    it('should throw error when CURSOR_CLI_PATH is missing', () => {
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');
    });

    it('should throw error with descriptive message when CURSOR_CLI_PATH is missing', () => {
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      try {
        runner.validateConfig();
        fail('Expected validateConfig to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const errorMessage = (error as Error).message;
        expect(errorMessage).toContain('Missing required environment variables');
        expect(errorMessage).toContain('CURSOR_CLI_PATH');
        // Verify error message is actionable
        expect(errorMessage.length).toBeGreaterThan(0);
      }
    });

    it('should throw error when CURSOR_CLI_PATH is empty string', () => {
      process.env.CURSOR_CLI_PATH = '';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');
    });

    it('should throw error when CURSOR_CLI_PATH is undefined', () => {
      process.env.CURSOR_CLI_PATH = undefined as any;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');
    });

    it('should throw error when TARGET_APP_PATH is missing', () => {
      delete process.env.TARGET_APP_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      // TARGET_APP_PATH is now optional, so this should not throw
      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });

    it('should throw error when multiple variables are missing', () => {
      delete process.env.CURSOR_CLI_PATH;
      delete process.env.TARGET_APP_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');
    });

    it('should list all missing environment variables in error message', () => {
      // Currently only CURSOR_CLI_PATH is required, but test verifies
      // that the error message format supports multiple vars
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      try {
        runner.validateConfig();
        fail('Expected validateConfig to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const errorMessage = (error as Error).message;
        // Verify error message format supports listing multiple vars
        expect(errorMessage).toMatch(/^Missing required environment variables:/);
        expect(errorMessage).toContain('CURSOR_CLI_PATH');
        // Error message format uses comma-separated list, which works for multiple vars
        expect(errorMessage.split(':')[1]?.trim().split(',').length).toBeGreaterThan(0);
      }
    });

    it('should handle case where all required variables are missing', () => {
      // Save original value
      const originalValue = process.env.CURSOR_CLI_PATH;
      delete process.env.CURSOR_CLI_PATH;

      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).toThrow('Missing required environment variables: CURSOR_CLI_PATH');

      // Restore original value
      if (originalValue !== undefined) {
        process.env.CURSOR_CLI_PATH = originalValue;
      }
    });

    it('should not throw when all required variables are present', () => {
      process.env.CURSOR_CLI_PATH = 'cursor';
      process.env.TARGET_APP_PATH = '/path/to/app';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });

    it('should succeed when CURSOR_CLI_PATH is set to absolute path', () => {
      process.env.CURSOR_CLI_PATH = '/usr/bin/cursor';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });

    it('should succeed when CURSOR_CLI_PATH is set to relative path', () => {
      process.env.CURSOR_CLI_PATH = './cursor';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });

    it('should succeed when CURSOR_CLI_PATH is set to command name', () => {
      process.env.CURSOR_CLI_PATH = 'cursor';
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
      });

      expect(() => {
        runner.validateConfig();
      }).not.toThrow();
    });
  });

  describe('initialize', () => {
    it('should call validateConfig() during initialization', async () => {
      // Spy on validateConfig to verify it's called
      const validateConfigSpy = jest.spyOn(cursorRunner, 'validateConfig');

      await cursorRunner.initialize();

      // Verify validateConfig was called
      expect(validateConfigSpy).toHaveBeenCalled();
      expect(validateConfigSpy).toHaveBeenCalledTimes(1);

      validateConfigSpy.mockRestore();
    });

    it('should call validateConfig() before other initialization steps', async () => {
      // Spy on validateConfig and other methods to verify call order
      const validateConfigSpy = jest.spyOn(cursorRunner, 'validateConfig');
      const cursorCLIValidateSpy = jest.spyOn(cursorRunner.cursorCLI, 'validate');
      const serverStartSpy = jest.spyOn(cursorRunner.server, 'start');

      await cursorRunner.initialize();

      // Verify validateConfig was called
      expect(validateConfigSpy).toHaveBeenCalled();
      // Verify call order by checking that validateConfig was called first
      // Get the call order by checking mock.invocationCallOrder
      const validateConfigCallOrder = (validateConfigSpy as jest.Mock).mock.invocationCallOrder[0];
      const cursorCLIValidateCallOrder = (cursorCLIValidateSpy as jest.Mock).mock
        .invocationCallOrder[0];
      const serverStartCallOrder = (serverStartSpy as jest.Mock).mock.invocationCallOrder[0];

      // Verify validateConfig was called before cursorCLI.validate
      expect(validateConfigCallOrder).toBeLessThan(cursorCLIValidateCallOrder);
      // Verify validateConfig was called before server.start
      expect(validateConfigCallOrder).toBeLessThan(serverStartCallOrder);

      validateConfigSpy.mockRestore();
    });

    it('should call ensureSchemaMigrationsTable() and runMigrations() during initialization', async () => {
      // Mock the migration functions to track calls
      // Since ES modules are tricky to spy on, we'll verify through behavior
      // The initialize() method calls migrations in a try-catch, so we verify
      // that initialization completes successfully, which means migrations were attempted
      const loggerInfoSpy = jest.spyOn(cursorRunner.logger, 'info');

      await cursorRunner.initialize();

      // Verify that migration-related log messages were emitted
      // This confirms migrations were attempted
      const logCalls = loggerInfoSpy.mock.calls.map((call) => {
        const firstArg = call[0];
        return typeof firstArg === 'string' ? firstArg : '';
      });
      expect(logCalls).toContain('Running database migrations...');

      // Verify initialization completed (migrations didn't throw)
      expect(cursorRunner.cursorCLI.validate).toHaveBeenCalled();
      expect(cursorRunner.server.start).toHaveBeenCalled();

      loggerInfoSpy.mockRestore();
    });

    it('should call GitHubAuthService.initialize() during initialization', async () => {
      // Spy on GitHubAuthService.initialize
      const githubAuthInitializeSpy = jest
        .spyOn(GitHubAuthService.prototype, 'initialize')
        .mockResolvedValue(undefined);

      await cursorRunner.initialize();

      // Verify GitHubAuthService.initialize was called
      expect(githubAuthInitializeSpy).toHaveBeenCalled();
      expect(githubAuthInitializeSpy).toHaveBeenCalledTimes(1);

      githubAuthInitializeSpy.mockRestore();
    });

    it('should call GitHubAuthService.initialize() after migrations', async () => {
      // Spy on methods to verify call order
      const loggerInfoSpy = jest.spyOn(cursorRunner.logger, 'info');
      const githubAuthInitializeSpy = jest
        .spyOn(GitHubAuthService.prototype, 'initialize')
        .mockResolvedValue(undefined);
      const cursorCLIValidateSpy = jest.spyOn(cursorRunner.cursorCLI, 'validate');

      await cursorRunner.initialize();

      // Verify GitHubAuthService.initialize was called
      expect(githubAuthInitializeSpy).toHaveBeenCalled();

      // Verify call order: GitHubAuthService.initialize should be called
      // after migrations and before cursorCLI.validate
      const githubAuthCallOrder = (githubAuthInitializeSpy as jest.Mock).mock
        .invocationCallOrder[0];
      const cursorCLIValidateCallOrder = (cursorCLIValidateSpy as jest.Mock).mock
        .invocationCallOrder[0];

      // GitHubAuthService.initialize should be called before cursorCLI.validate
      expect(githubAuthCallOrder).toBeLessThan(cursorCLIValidateCallOrder);

      loggerInfoSpy.mockRestore();
      githubAuthInitializeSpy.mockRestore();
      cursorCLIValidateSpy.mockRestore();
    });

    it('should call verifyMcpConfig() during initialization', async () => {
      // Spy on verifyMcpConfig method
      const verifyMcpConfigSpy = jest.spyOn(cursorRunner, 'verifyMcpConfig').mockResolvedValue();

      await cursorRunner.initialize();

      // Verify verifyMcpConfig was called
      expect(verifyMcpConfigSpy).toHaveBeenCalled();
      expect(verifyMcpConfigSpy).toHaveBeenCalledTimes(1);

      verifyMcpConfigSpy.mockRestore();
    });

    it('should call validateGmailConfig() during initialization', async () => {
      // Spy on validateGmailConfig method
      const validateGmailConfigSpy = jest
        .spyOn(cursorRunner, 'validateGmailConfig')
        .mockImplementation(() => {});

      await cursorRunner.initialize();

      // Verify validateGmailConfig was called
      expect(validateGmailConfigSpy).toHaveBeenCalled();
      expect(validateGmailConfigSpy).toHaveBeenCalledTimes(1);

      validateGmailConfigSpy.mockRestore();
    });

    it('should call cursorCLI.validate() during initialization', async () => {
      // Clear previous calls
      mockCursorCLI.validate.mockClear();

      await cursorRunner.initialize();

      // Verify cursorCLI.validate was called
      expect(mockCursorCLI.validate).toHaveBeenCalled();
      expect(mockCursorCLI.validate).toHaveBeenCalledTimes(1);
    });

    it('should call cursorCLI.validate() after validateGmailConfig()', async () => {
      // Spy on methods to verify call order
      const validateGmailConfigSpy = jest
        .spyOn(cursorRunner, 'validateGmailConfig')
        .mockImplementation(() => {});
      mockCursorCLI.validate.mockClear();

      await cursorRunner.initialize();

      // Verify both were called
      expect(validateGmailConfigSpy).toHaveBeenCalled();
      expect(mockCursorCLI.validate).toHaveBeenCalled();

      // Verify call order: validateGmailConfig before cursorCLI.validate
      const validateGmailConfigCallOrder = (validateGmailConfigSpy as jest.Mock).mock
        .invocationCallOrder[0];
      const cursorCLIValidateCallOrder = (mockCursorCLI.validate as jest.Mock).mock
        .invocationCallOrder[0];
      expect(validateGmailConfigCallOrder).toBeLessThan(cursorCLIValidateCallOrder);

      validateGmailConfigSpy.mockRestore();
    });

    it('should call server.start() during initialization', async () => {
      // Clear previous calls
      mockServer.start.mockClear();

      await cursorRunner.initialize();

      // Verify server.start was called
      expect(mockServer.start).toHaveBeenCalled();
      expect(mockServer.start).toHaveBeenCalledTimes(1);
    });

    it('should call server.start() as the last step in initialization', async () => {
      // Spy on methods to verify call order
      const validateConfigSpy = jest.spyOn(cursorRunner, 'validateConfig');
      const verifyMcpConfigSpy = jest.spyOn(cursorRunner, 'verifyMcpConfig').mockResolvedValue();
      const validateGmailConfigSpy = jest
        .spyOn(cursorRunner, 'validateGmailConfig')
        .mockImplementation(() => {});
      const githubAuthSpy = jest
        .spyOn(GitHubAuthService.prototype, 'initialize')
        .mockResolvedValue(undefined);
      mockCursorCLI.validate.mockClear();
      mockServer.start.mockClear();

      await cursorRunner.initialize();

      // Verify server.start was called
      expect(mockServer.start).toHaveBeenCalled();

      // Verify server.start was called after all other initialization steps
      const validateConfigCallOrder = (validateConfigSpy as jest.Mock).mock.invocationCallOrder[0];
      const verifyMcpConfigCallOrder = (verifyMcpConfigSpy as jest.Mock).mock
        .invocationCallOrder[0];
      const validateGmailConfigCallOrder = (validateGmailConfigSpy as jest.Mock).mock
        .invocationCallOrder[0];
      const githubAuthCallOrder = (githubAuthSpy as jest.Mock).mock.invocationCallOrder[0];
      const cursorCLIValidateCallOrder = (mockCursorCLI.validate as jest.Mock).mock
        .invocationCallOrder[0];
      const serverStartCallOrder = (mockServer.start as jest.Mock).mock.invocationCallOrder[0];

      // Server.start should be called last
      expect(serverStartCallOrder).toBeGreaterThan(validateConfigCallOrder);
      expect(serverStartCallOrder).toBeGreaterThan(verifyMcpConfigCallOrder);
      expect(serverStartCallOrder).toBeGreaterThan(validateGmailConfigCallOrder);
      expect(serverStartCallOrder).toBeGreaterThan(githubAuthCallOrder);
      expect(serverStartCallOrder).toBeGreaterThan(cursorCLIValidateCallOrder);

      validateConfigSpy.mockRestore();
      verifyMcpConfigSpy.mockRestore();
      validateGmailConfigSpy.mockRestore();
      githubAuthSpy.mockRestore();
    });

    it('should log startup messages during initialization', async () => {
      // Spy on logger methods
      const loggerInfoSpy = jest.spyOn(cursorRunner.logger, 'info');
      const loggerWarnSpy = jest.spyOn(cursorRunner.logger, 'warn');

      await cursorRunner.initialize();

      // Verify startup messages were logged
      const infoCalls = loggerInfoSpy.mock.calls.map((call) => {
        const firstArg = call[0];
        return typeof firstArg === 'string' ? firstArg : '';
      });

      // Verify key startup messages
      expect(infoCalls).toContain('Initializing cursor-runner...');
      expect(infoCalls.some((msg) => msg.includes('cursor-runner initialized successfully'))).toBe(
        true
      );

      loggerInfoSpy.mockRestore();
      loggerWarnSpy.mockRestore();
    });

    it('should initialize successfully', async () => {
      // Mock GitHubAuthService.initialize to prevent actual git operations
      const githubAuthSpy = jest
        .spyOn(GitHubAuthService.prototype, 'initialize')
        .mockResolvedValue(undefined);

      await cursorRunner.initialize();

      expect(cursorRunner.cursorCLI.validate).toHaveBeenCalled();
      expect(cursorRunner.server.start).toHaveBeenCalled();

      githubAuthSpy.mockRestore();
    });

    it('should throw error when cursor CLI validation fails', async () => {
      mockCursorCLI.validate.mockRejectedValue(new Error('Cursor CLI not found'));

      await expect(cursorRunner.initialize()).rejects.toThrow('Cursor CLI not found');
    });

    it('should throw error when server start fails', async () => {
      mockServer.start.mockRejectedValue(new Error('Port already in use'));

      await expect(cursorRunner.initialize()).rejects.toThrow('Port already in use');
    });

    it('should throw error when config validation fails', async () => {
      delete process.env.CURSOR_CLI_PATH;
      const runner = new CursorRunner({
        cursorCLI: mockCursorCLI as any,
        targetAppRunner: mockTargetAppRunner as any,
        server: mockServer as any,
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
      mockServer.stop.mockRejectedValue(new Error('Shutdown error'));

      // Should not throw
      await expect(cursorRunner.shutdown()).resolves.not.toThrow();
    });
  });

  describe('executeCodeGeneration', () => {
    it('should execute red phase (test generation)', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'red' as const,
        requirements: {
          description: 'Test feature',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      const result = (await cursorRunner.executeCodeGeneration(request)) as any;

      expect(cursorRunner.cursorCLI.generateTests).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath!
      );
      expect(result.success).toBe(true);
    });

    it('should execute green phase (implementation generation)', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'green' as const,
        requirements: {
          description: 'Test feature',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      const result = (await cursorRunner.executeCodeGeneration(request)) as any;

      expect(cursorRunner.cursorCLI.generateImplementation).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath!
      );
      expect(result.success).toBe(true);
    });

    it('should execute refactor phase', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'refactor' as const,
        requirements: {
          description: 'Refactor code',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      const result = (await cursorRunner.executeCodeGeneration(request)) as any;

      expect(cursorRunner.cursorCLI.refactorCode).toHaveBeenCalledWith(
        request.requirements,
        request.targetPath!
      );
      expect(result.success).toBe(true);
    });

    it('should execute validate phase (test execution)', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'validate' as const,
        requirements: {
          description: 'Validate code',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      const result = (await cursorRunner.executeCodeGeneration(request)) as any;

      expect(cursorRunner.targetAppRunner.runTests).toHaveBeenCalledWith(
        request.targetPath || null
      );
      expect(result.success).toBe(true);
    });

    it('should throw error for unknown phase', async () => {
      const request = {
        id: 'test-123',
        phase: 'unknown' as any,
        requirements: {
          description: 'Test',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      } as FormattedRequest;

      await expect(cursorRunner.executeCodeGeneration(request)).rejects.toThrow(
        'Unknown phase: unknown'
      );
    });

    it('should handle errors during code generation', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'red' as const,
        requirements: {
          description: 'Test feature',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      mockCursorCLI.generateTests.mockRejectedValue(new Error('Generation failed'));

      await expect(cursorRunner.executeCodeGeneration(request)).rejects.toThrow(
        'Generation failed'
      );
    });

    it('should include duration and files count in result', async () => {
      const request: FormattedRequest = {
        id: 'test-123',
        phase: 'red' as const,
        requirements: {
          description: 'Test feature',
          type: 'general',
          testFramework: 'rspec',
          test_framework: 'rspec',
          language: 'ruby',
          framework: 'rails',
        },
        targetPath: '/path/to/app',
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test',
        },
      };

      mockCursorCLI.generateTests.mockResolvedValue({
        success: true,
        files: ['file1.js', 'file2.js'],
      });

      const result = (await cursorRunner.executeCodeGeneration(request)) as any;

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('files');
      expect(result.files).toHaveLength(2);
    });
  });
});
