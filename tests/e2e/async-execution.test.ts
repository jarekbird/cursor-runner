// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express, { type Express } from 'express';
import { Server } from '../../src/server.js';

describe('E2E: Async Execute Flow', () => {
  let server: Server;
  let app: any;
  let callbackServer: Express;
  let callbackServerInstance: any;
  let callbackPort: number;
  let receivedCallbacks: any[];
  let mockExecute: ReturnType<typeof jest.spyOn>;

  beforeEach(async () => {
    server = new Server();
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
    callbackServerInstance = callbackServer.listen(0);
    callbackPort = (callbackServerInstance.address() as any)?.port || 0;

    // Mock execute to avoid running cursor-cli, but still exercise callbackWebhook behavior
    mockExecute = jest
      .spyOn(server.cursorExecution, 'execute')
      .mockImplementation(async (params: any) => {
        const responseBody = {
          success: true as const,
          requestId: params.requestId || 'test-request-id',
          repository: params.repository || null,
          branchName: params.branchName,
          command: ['cursor', '--print', params.prompt],
          output: 'Task completed successfully',
          error: null,
          exitCode: 0,
          duration: '1500ms',
          timestamp: new Date().toISOString(),
        };

        if (params.callbackUrl) {
          server.cursorExecution
            .callbackWebhook(
              params.callbackUrl,
              responseBody,
              params.requestId || 'test-request-id'
            )
            .catch(() => {
              // ignore in test
            });
        }

        return {
          status: 200,
          body: responseBody,
        };
      });
  });

  afterEach(async () => {
    if (callbackServerInstance) {
      await new Promise<void>((resolve) => {
        callbackServerInstance.close(() => resolve());
      });
    }
    mockExecute.mockRestore();
    jest.clearAllMocks();
  });

  it('should complete full flow from request to callback webhook', async () => {
    const callbackUrl = `http://localhost:${callbackPort}/callback?secret=test-secret`;

    // Make async execute request
    const response = await request(app)
      .post('/cursor/execute/async')
      .send({
        repository: 'test-repo',
        prompt: 'Test prompt',
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

    // Verify callback payload structure
    expect(callback.body).toMatchObject({
      success: true,
      requestId: expect.any(String),
      repository: 'test-repo',
      output: expect.any(String),
      exitCode: 0,
      duration: expect.any(String),
      timestamp: expect.any(String),
    });

    // Verify callback headers include secret (moved from query string to headers)
    expect(callback.headers['x-webhook-secret']).toBe('test-secret');
  });
});
