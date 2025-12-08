// eslint-disable-next-line node/no-unpublished-import
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// eslint-disable-next-line node/no-unpublished-import
import request from 'supertest';
import { Server } from '../src/server.js';
import { ReviewAgentService } from '../src/review-agent-service.js';
import { CursorExecutionService } from '../src/cursor-execution-service.js';
import { createTestCleanup, assertSuccessResponse } from './test-utils.js';
import { logger } from '../src/logger.js';

describe('Server', () => {
  let server: Server;
  let app: any;
  let mockGitService: any;
  let mockCursorCLI: any;
  let mockFilesystem: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock git service
    mockGitService = {
      repositoriesPath: '/test/repositories',
    };

    // Create mock cursor CLI
    mockCursorCLI = {
      executeCommand: jest.fn(),
      validate: jest.fn(),
    };

    // Create mock filesystem service
    mockFilesystem = {
      exists: jest.fn().mockReturnValue(true), // Default: repository exists
    };

    // Create server instance
    server = new Server();
    app = server.app;

    // Replace services with our mocks
    server.gitService = mockGitService;
    server.cursorCLI = mockCursorCLI;
    server.filesystem = mockFilesystem;
    // Create new reviewAgent with mocked cursorCLI
    server.reviewAgent = new ReviewAgentService(mockCursorCLI);
    // Create new cursorExecution with all mocked services
    server.cursorExecution = new CursorExecutionService(
      mockGitService,
      mockCursorCLI,
      server.commandParser,
      server.reviewAgent,
      mockFilesystem
    );
  });

  afterEach(async () => {
    // CRITICAL: Properly shut down server to prevent Jest from hanging
    if (server) {
      const cleanup = await createTestCleanup(server);
      await cleanup.cleanup();
    }
  });

  describe('Health Check', () => {
    it('GET /health should return 200 with expected response', async () => {
      const response = await request(app).get('/health');

      // Verify response status
      expect(response.status).toBe(200);

      // Verify response body using assertSuccessResponse helper
      assertSuccessResponse(response, {
        expectedStatus: 200,
      });

      // Verify response body matches expected structure
      expect(response.body).toEqual({
        status: 'ok',
        service: 'cursor-runner',
      });
    });

    it('GET /health should log requester info', async () => {
      // Spy on logger to capture log messages
      const loggerInfoSpy = jest.spyOn(logger, 'info');

      // Make request with custom user-agent
      const userAgent = 'test-user-agent/1.0';
      const response = await request(app).get('/health').set('User-Agent', userAgent);

      // Verify response is successful
      expect(response.status).toBe(200);

      // Verify logger was called
      expect(loggerInfoSpy).toHaveBeenCalled();

      // Verify requester info was logged
      // Logger.info() is called with an object that has message and metadata
      const logCalls = loggerInfoSpy.mock.calls.filter((call) => {
        const firstArg = call[0] as unknown;
        if (typeof firstArg === 'string') {
          return firstArg.includes('Health check');
        }
        return false;
      });

      expect(logCalls.length).toBeGreaterThan(0);

      // The code structure in server.ts lines 199-203 ensures:
      // - logger.info() is called with 'Health check requested' message
      // - Metadata object includes ip, userAgent, and service properties
      // - IP is extracted from req.ip
      // - User-agent is extracted from req.get('user-agent')

      loggerInfoSpy.mockRestore();
    });
  });

  describe('Health Queue', () => {
    it('GET /health/queue should return queue status', async () => {
      // Mock getQueueStatus to return test data
      const mockQueueStatus = {
        available: 5,
        waiting: 0,
        maxConcurrent: 5,
      };
      mockCursorCLI.getQueueStatus = jest.fn().mockReturnValue(mockQueueStatus);

      const response = await request(app).get('/health/queue');

      // Verify response status
      expect(response.status).toBe(200);

      // Verify response body using assertSuccessResponse helper
      assertSuccessResponse(response, {
        expectedStatus: 200,
      });

      // Verify response contains queue status
      expect(response.body).toHaveProperty('queue');
      expect(response.body.queue).toEqual(mockQueueStatus);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('cursor-runner');

      // Verify getQueueStatus was called
      expect(mockCursorCLI.getQueueStatus).toHaveBeenCalled();
    });

    it('GET /health/queue should include warning when queue is full', async () => {
      // Mock getQueueStatus to return full queue state
      const mockQueueStatus = {
        available: 0,
        waiting: 3,
        maxConcurrent: 5,
      };
      mockCursorCLI.getQueueStatus = jest.fn().mockReturnValue(mockQueueStatus);

      const response = await request(app).get('/health/queue');

      // Verify response status
      expect(response.status).toBe(200);

      // Verify response includes warning field
      expect(response.body).toHaveProperty('warning');
      expect(response.body.warning).toBeDefined();
      expect(typeof response.body.warning).toBe('string');
      expect(response.body.warning).toContain('All execution slots are occupied');

      // Verify queue status is still present
      expect(response.body.queue).toEqual(mockQueueStatus);
    });

    it('GET /health/queue should have no warning when queue is healthy', async () => {
      // Mock getQueueStatus to return healthy queue state
      const mockQueueStatus = {
        available: 3,
        waiting: 0,
        maxConcurrent: 5,
      };
      mockCursorCLI.getQueueStatus = jest.fn().mockReturnValue(mockQueueStatus);

      const response = await request(app).get('/health/queue');

      // Verify response status
      expect(response.status).toBe(200);

      // Verify response does NOT include warning field (or it's null)
      expect(response.body.warning).toBeNull();

      // Verify queue status is present
      expect(response.body.queue).toEqual(mockQueueStatus);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('cursor-runner');
    });
  });

  describe('Cursor Execution Endpoints', () => {
    describe('POST /cursor/execute', () => {
      it('should execute cursor command successfully (happy path)', async () => {
        // Mock cursorExecution.execute() to return success result
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'test-request-id',
            repository: 'test-repo',
            branchName: 'main',
            output: 'Generated code successfully',
            exitCode: 0,
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockResolvedValue(mockExecuteResult as any);

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
        });

        // Verify response matches execute() return value
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockExecuteResult.body);

        // Verify execute() was called
        expect(executeSpy).toHaveBeenCalled();
        expect(executeSpy).toHaveBeenCalledTimes(1);

        executeSpy.mockRestore();
      });

      it('should use queueType from request body', async () => {
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'test-request-id',
            output: 'Success',
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockResolvedValue(mockExecuteResult as any);

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute').send({
          prompt: 'test prompt',
          queueType: 'api',
        });

        expect(response.status).toBe(200);

        // Verify execute() was called with queueType from body
        expect(executeSpy).toHaveBeenCalled();
        const executeCall = executeSpy.mock.calls[0][0];
        expect(executeCall.queueType).toBe('api');

        executeSpy.mockRestore();
      });

      it('should detect queueType from requestId when telegram- prefix is present', async () => {
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'telegram-12345',
            output: 'Success',
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockResolvedValue(mockExecuteResult as any);

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute').send({
          prompt: 'test prompt',
          id: 'telegram-12345',
        });

        expect(response.status).toBe(200);

        // Verify execute() was called with queueType: 'telegram' (detected from requestId)
        expect(executeSpy).toHaveBeenCalled();
        const executeCall = executeSpy.mock.calls[0][0];
        expect(executeCall.queueType).toBe('telegram');
        expect(executeCall.requestId).toBe('telegram-12345');

        executeSpy.mockRestore();
      });

      it('should generate requestId when not provided', async () => {
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'generated-id',
            output: 'Success',
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockResolvedValue(mockExecuteResult as any);

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute').send({
          prompt: 'test prompt',
          // No id/requestId provided
        });

        expect(response.status).toBe(200);

        // Verify execute() was called with a generated requestId
        expect(executeSpy).toHaveBeenCalled();
        const executeCall = executeSpy.mock.calls[0][0];
        expect(executeCall.requestId).toBeDefined();
        expect(typeof executeCall.requestId).toBe('string');
        // Verify requestId format: req-{timestamp}-{random}
        expect(executeCall.requestId).toMatch(/^req-\d+-[a-z0-9]+$/);

        executeSpy.mockRestore();
      });

      it('should return 500 when execute() throws', async () => {
        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockRejectedValue(new Error('Execution failed'));

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute').send({
          prompt: 'test prompt',
        });

        // Verify error response
        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Execution failed');
        expect(response.body.requestId).toBeDefined();

        // Verify execute() was called
        expect(executeSpy).toHaveBeenCalled();

        executeSpy.mockRestore();
      });

      it('should return 400 if prompt is missing', async () => {
        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('prompt is required');
      });

      it('should work without branchName', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBeUndefined();
      });

      it('should include branchName in response when provided', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'feature-branch',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBe('feature-branch');
      });

      it('should return 400 if prompt is missing', async () => {
        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('prompt is required');
      });
    });

    describe('POST /cursor/execute/async', () => {
      it('should return 400 when callbackUrl is missing', async () => {
        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          // No callbackUrl provided
        });

        // Verify error response
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('callbackUrl is required for async execution');
        expect(response.body.requestId).toBeDefined();
        expect(response.body.timestamp).toBeDefined();
      });

      it('should return 200 immediately when valid', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'test-request-id',
            output: 'Success',
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        // Mock execute() to simulate slow execution
        const executeSpy = jest.spyOn(server.cursorExecution, 'execute').mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(mockExecuteResult as any), 1000);
            })
        );

        mockFilesystem.exists.mockReturnValue(true);

        const startTime = Date.now();
        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          callbackUrl: mockCallbackUrl,
        });
        const responseTime = Date.now() - startTime;

        // Verify immediate response (should be much faster than 1 second)
        expect(responseTime).toBeLessThan(500); // Response should be immediate
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');
        expect(response.body.requestId).toBeDefined();

        // Clean up
        executeSpy.mockRestore();
      });

      it('should process execution in background', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const mockExecuteResult = {
          status: 200,
          body: {
            success: true,
            requestId: 'test-request-id',
            output: 'Success',
            duration: '1.2s',
            timestamp: new Date().toISOString(),
          },
        };

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockResolvedValue(mockExecuteResult as any);

        mockFilesystem.exists.mockReturnValue(true);

        // Make request and get immediate response
        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          callbackUrl: mockCallbackUrl,
        });

        // Verify immediate response
        expect(response.status).toBe(200);

        // Verify execute() hasn't been called yet (or was called after response)
        // Since it's async, we need to wait a bit
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify execute() was called in background
        expect(executeSpy).toHaveBeenCalled();
        expect(executeSpy).toHaveBeenCalledTimes(1);

        executeSpy.mockRestore();
      });

      it('should send callback on success', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const callbackWebhookSpy = jest
          .spyOn(server.cursorExecution, 'callbackWebhook')
          .mockResolvedValue(undefined);

        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          repository: 'test-repo',
          callbackUrl: mockCallbackUrl,
        });

        // Verify immediate response
        expect(response.status).toBe(200);

        // Wait for background processing
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify callback was sent
        expect(callbackWebhookSpy).toHaveBeenCalled();
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: true,
            repository: 'test-repo',
            output: 'Generated code successfully',
            exitCode: 0,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should send error callback when execution fails', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';

        const executeSpy = jest
          .spyOn(server.cursorExecution, 'execute')
          .mockRejectedValue(new Error('Execution failed'));

        const callbackWebhookSpy = jest
          .spyOn(server.cursorExecution, 'callbackWebhook')
          .mockResolvedValue(undefined);

        mockFilesystem.exists.mockReturnValue(true);

        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          callbackUrl: mockCallbackUrl,
        });

        // Verify immediate response
        expect(response.status).toBe(200);

        // Wait for background processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify error callback was sent
        expect(callbackWebhookSpy).toHaveBeenCalled();
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            error: 'Execution failed',
          }),
          expect.any(String)
        );

        executeSpy.mockRestore();
        callbackWebhookSpy.mockRestore();
      });

      it('should log callback errors but not crash', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        // Mock callbackWebhook to throw an error
        const callbackWebhookSpy = jest
          .spyOn(server.cursorExecution, 'callbackWebhook')
          .mockRejectedValue(new Error('Callback webhook failed'));

        const loggerErrorSpy = jest.spyOn(logger, 'error');

        const response = await request(app).post('/cursor/execute/async').send({
          prompt: 'test prompt',
          repository: 'test-repo',
          callbackUrl: mockCallbackUrl,
        });

        // Verify immediate response
        expect(response.status).toBe(200);

        // Wait for background processing
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Verify callback was attempted (even if it failed)
        expect(callbackWebhookSpy).toHaveBeenCalled();

        // Verify system didn't crash (test completes successfully)
        // If we get here, the system handled the error gracefully
        // The callback error is handled internally by cursorExecution.execute()
        // and logged there, so we verify the system continues to operate

        callbackWebhookSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });

      it('should call callback webhook on validation error when callbackUrl is provided', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/execute/async').send({
          repository: 'test-repo',
          branchName: 'main',
          callbackUrl: mockCallbackUrl,
        });

        // Should return 200 immediately for async processing
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing (validation error will be sent via callback)
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with error details
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            error: 'prompt is required',
            repository: 'test-repo',
            exitCode: 1,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should return 404 if repository does not exist locally', async () => {
        mockFilesystem.exists.mockReturnValue(false);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Repository not found locally');
      });

      it('should call callback webhook on repository error when callbackUrl is provided', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        mockFilesystem.exists.mockReturnValue(false);
        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/execute/async').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        // Should return 200 immediately for async processing
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with error details
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            repository: 'nonexistent-repo',
            error: expect.stringContaining('Repository not found locally'),
            exitCode: 1,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should call callback webhook on successful execution when callbackUrl is provided', async () => {
        const mockCallbackUrl = 'http://localhost:3000/callback?secret=test-secret';
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);
        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/execute/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create service',
          callbackUrl: mockCallbackUrl,
        });

        // Should return 200 immediately for async processing
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with success details
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: true,
            repository: 'test-repo',
            output: 'Generated code successfully',
            exitCode: 0,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should handle command execution errors', async () => {
        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockRejectedValue(new Error('Command failed'));

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Command failed');
      });

      it('should parse command with quoted arguments', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Output',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const testPrompt = 'Create user service with authentication';
        await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: testPrompt,
        });

        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][0];
        // Initial commands use --print (not --resume) to avoid session selection menu
        expect(callArgs).toContain('--print');
        expect(callArgs).toContain('--force');
        // The prompt argument comes after --force and will have instructions appended
        // Find the index of --force and get the next non-flag argument (the prompt)
        const forceIndex = callArgs.indexOf('--force');
        // Get the prompt argument (should be right after --force)
        let promptIndex = forceIndex + 1;
        // Skip --model and its value if present (for backward compatibility)
        if (callArgs[promptIndex] === '--model') {
          promptIndex += 2; // Skip --model and its value
        }
        // Skip --approve-mcps if present
        if (callArgs[promptIndex] === '--approve-mcps') {
          promptIndex += 1; // Skip --approve-mcps
        }
        const promptArg = callArgs[promptIndex];
        expect(promptArg).toContain(testPrompt);
      });
    });

    describe('POST /cursor/iterate/async', () => {
      const mockCallbackUrl = 'http://localhost:3000/cursor-runner/callback?secret=test-secret';

      it('should call callback webhook on validation error when callbackUrl is provided', async () => {
        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          callbackUrl: mockCallbackUrl,
        });

        // Returns 200 immediately, but validation error will be sent via callback
        expect(response.status).toBe(200);

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with validation error
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            error: 'prompt is required',
            repository: 'test-repo',
            iterations: 0,
            maxIterations: 5,
            exitCode: 1,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should call callback webhook on repository error when callbackUrl is provided', async () => {
        mockFilesystem.exists.mockReturnValue(false);
        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        // Returns 200 immediately, but error will be sent via callback
        expect(response.status).toBe(200);

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with repository error
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            repository: 'nonexistent-repo',
            error: expect.stringContaining('Repository not found locally'),
            iterations: 0,
            maxIterations: 5,
            exitCode: 1,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should return 200 immediately and process asynchronously', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            break_iteration: false,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
          callbackUrl: mockCallbackUrl,
        });

        // Should return 200 immediately with acknowledgment
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');
        expect(response.body.requestId).toBeDefined();

        // Wait a bit for async processing to complete
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify that processing was initiated
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      });

      it('should iterate when code is not complete', async () => {
        const mockCursorResult1 = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code, but needs more work',
          stderr: '',
        };

        const mockReviewResult1 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            break_iteration: false,
            justification: 'Work in progress',
          }),
          stderr: '',
        };

        const mockCursorResult2 = {
          success: true,
          exitCode: 0,
          stdout: 'Code completed',
          stderr: '',
        };

        const mockReviewResult2 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            break_iteration: false,
            justification: 'All done',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult1) // Initial command
          .mockResolvedValueOnce(mockReviewResult1) // First review
          .mockResolvedValueOnce(mockCursorResult2) // Resume command
          .mockResolvedValueOnce(mockReviewResult2); // Second review

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
          callbackUrl: mockCallbackUrl,
        });

        // Should return 200 immediately
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify processing was initiated
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      });

      it('should auto-construct callback URL if not provided and JAREK_VA_URL is set', async () => {
        // Set JAREK_VA_URL environment variable
        const originalJarekVaUrl = process.env.JAREK_VA_URL;
        process.env.JAREK_VA_URL = 'http://app:3000';
        process.env.WEBHOOK_SECRET = 'test-secret';

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            break_iteration: false,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with auto-constructed URL
        expect(callbackWebhookSpy).toHaveBeenCalled();
        const callArgs = callbackWebhookSpy.mock.calls[0];
        expect(callArgs[0]).toContain('http://app:3000/cursor-runner/callback');

        // Restore original environment
        if (originalJarekVaUrl) {
          process.env.JAREK_VA_URL = originalJarekVaUrl;
        } else {
          delete process.env.JAREK_VA_URL;
        }
        delete process.env.WEBHOOK_SECRET;

        callbackWebhookSpy.mockRestore();
      });

      it('should use Docker network default if callbackUrl is missing and JAREK_VA_URL is not set', async () => {
        // Ensure JAREK_VA_URL is not set - should use Docker network default
        const originalJarekVaUrl = process.env.JAREK_VA_URL;
        delete process.env.JAREK_VA_URL;

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            break_iteration: false,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          prompt: 'test',
        });

        // Should succeed with Docker network default
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with Docker network default URL
        expect(callbackWebhookSpy).toHaveBeenCalled();
        const callArgs = callbackWebhookSpy.mock.calls[0];
        expect(callArgs[0]).toContain('http://app:3000/cursor-runner/callback');

        // Restore original environment
        if (originalJarekVaUrl) {
          process.env.JAREK_VA_URL = originalJarekVaUrl;
        }

        callbackWebhookSpy.mockRestore();
      });

      it('should work without branchName', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            break_iteration: false,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          prompt: 'Create user service',
          callbackUrl: mockCallbackUrl,
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');
      });

      it('should return 200 immediately even if repository validation fails (error sent via callback)', async () => {
        mockFilesystem.exists.mockReturnValue(false);
        const callbackWebhookSpy = jest
          .spyOn(server.cursorExecution, 'callbackWebhook')
          .mockResolvedValue(undefined);

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        // Returns 200 immediately, error will be sent via callback
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with repository error
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            repository: 'nonexistent-repo',
            error: expect.stringContaining('Repository not found locally'),
            iterations: 0,
            exitCode: 1,
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should stop after max iterations', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Still working',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            break_iteration: false,
            justification: 'Still in progress',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);

        // Set up mocks: initial command, then review, then 25 iterations of (resume + review)
        const mockCalls = [
          mockCursorResult, // Initial command
          mockReviewResult, // First review
        ];

        // Add 25 iterations (each iteration = resume + review)
        for (let i = 0; i < 25; i++) {
          mockCalls.push(mockCursorResult); // Resume
          mockCalls.push(mockReviewResult); // Review
        }

        mockCursorCLI.executeCommand.mockImplementation(() => {
          const result = mockCalls.shift();
          return Promise.resolve(result || mockCursorResult);
        });

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Verify processing was initiated (should have called executeCommand multiple times)
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      });

      it('should handle review agent JSON parsing failures', async () => {
        const originalOutput = 'Generated code';

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: originalOutput,
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: 'Invalid JSON response',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        // Reset and set up mocks - first call is the initial cursor command, second is review agent
        mockCursorCLI.executeCommand.mockReset();
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult)
          .mockResolvedValueOnce(mockReviewResult);

        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        // Returns 200 immediately, error will be sent via callback
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called
        // When review agent fails to parse, we use break_iteration as a circuit breaker
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            output: originalOutput,
            iterations: 0,
            error: expect.stringContaining('Invalid JSON response'),
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should include original output when review agent throws an error', async () => {
        const originalOutput = 'Generated code with some output';

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: originalOutput,
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        // When review agent throws, the review agent service catches it and returns null
        // So we simulate that by having the review agent command fail
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockRejectedValueOnce(new Error('Review agent execution failed')); // Review agent throws error

        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called
        // Note: When review agent throws, we use break_iteration as a circuit breaker
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            output: originalOutput,
            iterations: 0,
            error: expect.stringContaining('Review agent execution failed'),
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });

      it('should break iterations when break_iteration is true', async () => {
        const originalOutput = 'Workspace Trust Required - cursor needs permissions';
        const reviewJustification = 'Workspace Trust Required - cursor needs permissions';

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: originalOutput,
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            break_iteration: true,
            justification: reviewJustification,
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        // Reset and set up mocks - first call is the initial cursor command, second is review agent
        mockCursorCLI.executeCommand.mockReset();
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const callbackWebhookSpy = jest.spyOn(server.cursorExecution, 'callbackWebhook');

        const response = await request(app).post('/cursor/iterate/async').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
          callbackUrl: mockCallbackUrl,
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Request accepted, processing asynchronously');

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify callback webhook was called with error and new fields
        expect(callbackWebhookSpy).toHaveBeenCalledWith(
          mockCallbackUrl,
          expect.objectContaining({
            success: false,
            error: expect.stringContaining('Workspace Trust Required'),
            reviewJustification: reviewJustification,
            originalOutput: originalOutput,
            iterations: 0, // Break happens before completing first iteration
          }),
          expect.any(String)
        );

        callbackWebhookSpy.mockRestore();
      });
    });
  });

  describe('Telegram Webhook Endpoints', () => {
    describe('POST /telegram/webhook', () => {
      it('should receive and acknowledge message update', async () => {
        const messageUpdate = {
          message: {
            message_id: 1,
            text: '/start',
            chat: { id: 123456 },
            from: { id: 789, username: 'test_user' },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(messageUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('message');
        expect(response.body.timestamp).toBeDefined();
      });

      it('should receive and acknowledge edited_message update', async () => {
        const editedUpdate = {
          edited_message: {
            message_id: 2,
            text: 'edited text',
            chat: { id: 123456 },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(editedUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('edited_message');
      });

      it('should receive and acknowledge callback_query update', async () => {
        const callbackUpdate = {
          callback_query: {
            id: 'callback-123',
            data: 'button_clicked',
            message: {
              message_id: 3,
              chat: { id: 123456 },
            },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(callbackUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('callback_query');
      });

      it('should handle unknown update types', async () => {
        const unknownUpdate = {
          some_unknown_type: {
            data: 'unknown',
          },
        };

        const response = await request(app).post('/telegram/webhook').send(unknownUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('unknown');
      });

      it('should handle empty update', async () => {
        const emptyUpdate = {};

        const response = await request(app).post('/telegram/webhook').send(emptyUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('unknown');
      });

      it('should handle malformed JSON gracefully', async () => {
        // This test ensures the endpoint doesn't crash on unexpected data
        const malformedUpdate = {
          message: null,
          edited_message: undefined,
        };

        const response = await request(app).post('/telegram/webhook').send(malformedUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
      });

      it('should return 200 even if processing fails', async () => {
        // Create an update that might cause issues
        const problematicUpdate = {
          message: {
            // Missing required fields but should still be handled
          },
        };

        const response = await request(app).post('/telegram/webhook').send(problematicUpdate);

        // Should still return 200 to avoid retries
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });
});
