// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';
import { Server } from '../../src/server.js';
import { CursorExecutionService } from '../../src/cursor-execution-service.js';
import { GitService } from '../../src/git-service.js';
import { CursorCLI } from '../../src/cursor-cli.js';
import { CommandParserService } from '../../src/command-parser-service.js';
import type Redis from 'ioredis';
import { createMockRedisClient } from '../test-utils.js';

describe.skip('E2E: Async Iteration Flow', () => {
  let server: Server;
  let app: any;
  let callbackServer: Express;
  let callbackServerInstance: any;
  let callbackPort: number;
  let receivedCallbacks: any[];
  let mockIterate: ReturnType<typeof jest.spyOn>;
  let cursorExecutionRef: CursorExecutionService;

  beforeEach(async () => {
    // Create a mock Redis client
    const redisClient = createMockRedisClient() as unknown as Redis;

    // Create real services
    const gitService = new GitService();
    const cursorCLI = new CursorCLI();
    const commandParser = new CommandParserService();
    const cursorExecution = new CursorExecutionService(
      gitService,
      cursorCLI,
      commandParser,
      null,
      redisClient
    );

    // Store cursorExecution reference for use in mocks
    cursorExecutionRef = cursorExecution;

    // Mock the iterate method to simulate successful iteration (iterate method no longer exists)
    mockIterate = jest
      .spyOn(cursorExecution as any, 'iterate')
      .mockImplementation(async (params: any) => {
        // Simulate a successful iteration
        const responseBody = {
          success: true as const,
          requestId: params.requestId || 'test-request-id',
          repository: params.repository || null,
          branchName: params.branchName,
          command: ['cursor', '--prompt', params.prompt],
          output: 'Task completed successfully',
          error: null,
          exitCode: 0,
          duration: '1500ms',
          timestamp: new Date().toISOString(),
          iterations: 2,
          maxIterations: params.maxIterations || 5,
        };

        // Call the callback webhook if provided
        if (params.callbackUrl) {
          // Call it asynchronously to match real behavior
          cursorExecutionRef
            .callbackWebhook(
              params.callbackUrl,
              responseBody,
              params.requestId || 'test-request-id'
            )
            .catch(() => {
              // Ignore errors in test
            });
        }

        return {
          status: 200,
          body: responseBody,
        };
      });

    // Create server
    server = new Server();
    // Replace cursorExecution with our mocked version
    server.cursorExecution = cursorExecution;
    app = server.app;

    // Set up callback server to receive webhooks
    callbackServer = express();
    callbackServer.use(express.json());
    receivedCallbacks = [];

    callbackServer.post('/callback', (req, res) => {
      receivedCallbacks.push({
        body: req.body,
        headers: req.headers,
        timestamp: new Date().toISOString(),
      });
      res.status(200).json({ received: true });
    });

    // Start callback server on a random port
    callbackPort = 0; // Let system assign port
    callbackServerInstance = callbackServer.listen(0);
    callbackPort = (callbackServerInstance.address() as any)?.port || 0;
  });

  afterEach(async () => {
    // Clean up
    if (callbackServerInstance) {
      await new Promise<void>((resolve) => {
        callbackServerInstance.close(() => resolve());
      });
    }
    mockIterate.mockRestore();
    jest.clearAllMocks();
  });

  it('should complete full flow from request to callback webhook', async () => {
    const callbackUrl = `http://localhost:${callbackPort}/callback?secret=test-secret`;

    // Make async iteration request
    const response = await request(app)
      .post('/cursor/iterate/async')
      .send({
        repository: 'test-repo',
        prompt: 'Test prompt',
        maxIterations: 3,
        callbackUrl,
      })
      .expect(200);

    // Verify immediate response
    expect(response.body).toMatchObject({
      success: true,
      message: 'Request accepted, processing asynchronously',
    });
    expect(response.body.requestId).toBeDefined();
    expect(response.body.timestamp).toBeDefined();

    // Wait for callback to be received (with timeout)
    const maxWaitTime = 5000; // 5 seconds
    const startTime = Date.now();
    while (receivedCallbacks.length === 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Verify callback was received
    expect(receivedCallbacks.length).toBeGreaterThan(0);
    const callback = receivedCallbacks[0];

    // Verify callback payload structure matches SuccessResponseBody
    expect(callback.body).toMatchObject({
      success: true,
      requestId: expect.any(String),
      repository: 'test-repo',
      output: expect.any(String),
      exitCode: 0,
      duration: expect.stringMatching(/^\d+ms$/),
      timestamp: expect.any(String),
      iterations: expect.any(Number),
      maxIterations: 3,
    });

    // Verify all required fields are present
    expect(callback.body.success).toBe(true);
    expect(callback.body.requestId).toBeDefined();
    expect(callback.body.duration).toBeDefined();
    expect(callback.body.timestamp).toBeDefined();
    expect(callback.body.iterations).toBeDefined();
    expect(callback.body.maxIterations).toBeDefined();

    // Verify callback headers include secret
    expect(callback.headers['x-webhook-secret']).toBe('test-secret');
  });

  it('should handle error case and send error callback', async () => {
    const callbackUrl = `http://localhost:${callbackPort}/callback?secret=test-secret`;

    // Mock iterate to simulate an error
    mockIterate.mockImplementation(async (params: any) => {
      const errorResponseBody = {
        success: false as const,
        requestId: params.requestId || 'test-request-id',
        repository: params.repository || null,
        error: 'Iteration failed: Command timeout',
        exitCode: -1,
        duration: '5000ms',
        timestamp: new Date().toISOString(),
        iterations: 1,
        maxIterations: params.maxIterations || 5,
        output: 'Partial output before timeout',
      };

      // Call the callback webhook if provided
      if (params.callbackUrl) {
        cursorExecutionRef
          .callbackWebhook(
            params.callbackUrl,
            errorResponseBody,
            params.requestId || 'test-request-id'
          )
          .catch(() => {
            // Ignore errors in test
          });
      }

      return {
        status: 422,
        body: {
          success: false,
          error: 'Iteration failed: Command timeout',
        },
      };
    });

    // Make async iteration request
    const response = await request(app)
      .post('/cursor/iterate/async')
      .send({
        repository: 'test-repo',
        prompt: 'Test prompt',
        maxIterations: 3,
        callbackUrl,
      })
      .expect(200);

    // Verify immediate response
    expect(response.body.success).toBe(true);

    // Wait for callback to be received
    const maxWaitTime = 5000;
    const startTime = Date.now();
    while (receivedCallbacks.length === 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Verify error callback was received
    expect(receivedCallbacks.length).toBeGreaterThan(0);
    const callback = receivedCallbacks[0];

    // Verify error callback payload structure
    expect(callback.body).toMatchObject({
      success: false,
      requestId: expect.any(String),
      repository: 'test-repo',
      error: expect.any(String),
      exitCode: expect.any(Number),
      duration: expect.stringMatching(/^\d+ms$/),
      timestamp: expect.any(String),
      iterations: expect.any(Number),
      maxIterations: 3,
      output: expect.any(String),
    });

    // Verify all required error fields are present
    expect(callback.body.success).toBe(false);
    expect(callback.body.error).toBeDefined();
    expect(callback.body.requestId).toBeDefined();
    expect(callback.body.timestamp).toBeDefined();
  });

  it('should auto-construct callback URL if not provided', async () => {
    // Make request without callbackUrl
    const response = await request(app)
      .post('/cursor/iterate/async')
      .send({
        repository: 'test-repo',
        prompt: 'Test prompt',
      })
      .expect(200);

    // Verify immediate response
    expect(response.body.success).toBe(true);

    // Verify iterate was called (it will handle callback URL construction)
    expect(mockIterate).toHaveBeenCalled();
    const callArgs = mockIterate.mock.calls[0][0];
    // The callback URL should be auto-constructed
    expect(callArgs.callbackUrl).toBeDefined();
  });
});
