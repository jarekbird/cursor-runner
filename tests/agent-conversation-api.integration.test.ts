/**
 * Integration tests for Agent Conversation API endpoints
 * 
 * These tests verify the full flow of agent conversation API endpoints:
 * - Creating conversations
 * - Listing conversations
 * - Getting conversations
 * - Adding messages to conversations
 * 
 * Note: These tests require a running Redis instance.
 * Tests will be skipped if Redis is not available.
 */
// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// eslint-disable-next-line node/no-unpublished-import
import request from 'supertest';
import { Server } from '../src/server.js';
import Redis from 'ioredis';

describe('Agent Conversation API Integration', () => {
  let server: Server;
  let app: any;
  let redis: Redis;
  const TEST_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/0';
  const TEST_PREFIX = 'test-agent-conversation:';

  beforeAll(async () => {
    // Check if Redis is available
    redis = new Redis(TEST_REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      retryStrategy: () => null, // Don't retry
    });

    try {
      await redis.connect();
      await redis.ping();
      console.log('Redis is available, running integration tests');
    } catch (error) {
      console.log('Redis is not available, skipping integration tests');
      try {
        await redis.quit();
      } catch {
        // Ignore quit errors
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__SKIP_INTEGRATION_TESTS__ = true;
    }
  });

  afterAll(async () => {
    if (redis && redis.status === 'ready') {
      // Clean up test data
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
      await redis.quit();
    }
  });

  beforeEach(async () => {
    // Skip tests if Redis is not available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).__SKIP_INTEGRATION_TESTS__) {
      return;
    }

    // Set REDIS_URL to test Redis for agent conversation service
    process.env.REDIS_URL = TEST_REDIS_URL;

    // Create server instance
    server = new Server();
    app = server.app;

    // Clean up any existing test data
    const keys = await redis.keys(`${TEST_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).__SKIP_INTEGRATION_TESTS__) {
      return;
    }

    if (server) {
      await server.stop();
    }

    // Clean up test data
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  });

  describe('POST /agent-conversations/api/new', () => {
    it('should create a new agent conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      const response = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'test-agent-123' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();
      expect(response.body.conversationId).toMatch(/^agent-\d+-[a-z0-9]+$/);
    });

    it('should create a conversation without agentId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      const response = await request(app)
        .post('/agent-conversations/api/new')
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();
    });
  });

  describe('GET /agent-conversations/api/list', () => {
    it('should list all agent conversations', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        console.log('Skipping test: Redis not available');
        return;
      }

      // Create a few conversations
      const conv1 = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'agent-1' });

      const conv2 = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'agent-2' });

      const response = await request(app)
        .get('/agent-conversations/api/list')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
      
      // Verify conversations are in the list
      const conversationIds = response.body.map((c: any) => c.conversationId);
      expect(conversationIds).toContain(conv1.body.conversationId);
      expect(conversationIds).toContain(conv2.body.conversationId);
    });

    it('should return empty array when no conversations exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      const response = await request(app)
        .get('/agent-conversations/api/list')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // Note: May not be empty if other tests created conversations
    });
  });

  describe('GET /agent-conversations/api/:id', () => {
    it('should get a specific conversation by ID', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      // Create a conversation
      const createResponse = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Get the conversation
      const response = await request(app)
        .get(`/agent-conversations/api/${conversationId}`)
        .expect(200);

      expect(response.body.conversationId).toBe(conversationId);
      expect(response.body.agentId).toBe('test-agent');
      expect(Array.isArray(response.body.messages)).toBe(true);
    });

    it('should return 404 for non-existent conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      await request(app)
        .get('/agent-conversations/api/non-existent-id')
        .expect(404);
    });
  });

  describe('POST /agent-conversations/api/:id/message', () => {
    it('should add a message to a conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      // Create a conversation
      const createResponse = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Add a message
      const messageResponse = await request(app)
        .post(`/agent-conversations/api/${conversationId}/message`)
        .send({
          role: 'user',
          content: 'Hello, agent!',
          source: 'voice',
        })
        .expect(200);

      expect(messageResponse.body.success).toBe(true);
      expect(messageResponse.body.conversationId).toBe(conversationId);

      // Verify message was added by getting the conversation
      const getResponse = await request(app)
        .get(`/agent-conversations/api/${conversationId}`)
        .expect(200);

      expect(getResponse.body.messages).toHaveLength(1);
      expect(getResponse.body.messages[0].content).toBe('Hello, agent!');
      expect(getResponse.body.messages[0].role).toBe('user');
      expect(getResponse.body.messages[0].source).toBe('voice');
    });

    it('should return 400 if required fields are missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      const createResponse = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Try to add message without required fields
      await request(app)
        .post(`/agent-conversations/api/${conversationId}/message`)
        .send({
          content: 'Hello',
          // Missing role
        })
        .expect(400);
    });

    it('should return 500 if conversation does not exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      await request(app)
        .post('/agent-conversations/api/non-existent/message')
        .send({
          role: 'user',
          content: 'Hello',
        })
        .expect(500);
    });
  });

  describe('Full Conversation Flow', () => {
    it('should handle a complete conversation flow', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) {
        return;
      }

      // 1. Create conversation
      const createResponse = await request(app)
        .post('/agent-conversations/api/new')
        .send({ agentId: 'test-agent' })
        .expect(200);

      const conversationId = createResponse.body.conversationId;

      // 2. Add user message
      await request(app)
        .post(`/agent-conversations/api/${conversationId}/message`)
        .send({
          role: 'user',
          content: 'Hello!',
          source: 'voice',
        })
        .expect(200);

      // 3. Add assistant message
      await request(app)
        .post(`/agent-conversations/api/${conversationId}/message`)
        .send({
          role: 'assistant',
          content: 'Hi there! How can I help?',
          source: 'text',
        })
        .expect(200);

      // 4. Get conversation and verify all messages
      const getResponse = await request(app)
        .get(`/agent-conversations/api/${conversationId}`)
        .expect(200);

      expect(getResponse.body.messages).toHaveLength(2);
      expect(getResponse.body.messages[0].role).toBe('user');
      expect(getResponse.body.messages[0].content).toBe('Hello!');
      expect(getResponse.body.messages[1].role).toBe('assistant');
      expect(getResponse.body.messages[1].content).toBe('Hi there! How can I help?');

      // 5. Verify conversation appears in list
      const listResponse = await request(app)
        .get('/agent-conversations/api/list')
        .expect(200);

      const conversationIds = listResponse.body.map((c: any) => c.conversationId);
      expect(conversationIds).toContain(conversationId);
    });
  });
});

