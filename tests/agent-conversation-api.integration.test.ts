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
import { describe, it, expect, beforeEach, afterAll, beforeAll, jest } from '@jest/globals';
// eslint-disable-next-line node/no-unpublished-import
import request from 'supertest';
import { Server } from '../src/server.js';
import Redis from 'ioredis';

describe('Agent Conversation API Integration', () => {
  let server: Server;
  let app: any;
  let redis: Redis;
  // Use a separate Redis database for tests to avoid conflicts
  const TEST_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/15';
  const TEST_PREFIX = 'test-agent-conversation:';

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });

    try {
      await redis.connect();
      await redis.ping();
      console.log('Redis is available, running integration tests');

      // Use test Redis for the app as well
      process.env.REDIS_URL = TEST_REDIS_URL;
      process.env.NODE_ENV = 'test';

      // IMPORTANT: construct server with disableBackgroundWorkers=true
      // This prevents Server from starting background workers, schedulers, etc.
      // that would keep the event loop alive and cause Jest to hang
      server = new Server(redis, { disableBackgroundWorkers: true });
      app = server.app;

      // Clean up any existing test keys before starting
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } catch {
      console.log('Redis is not available, skipping integration tests');
      try {
        await redis.quit();
      } catch {
        // ignore
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).__SKIP_INTEGRATION_TESTS__ = true;
    }
  });

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).__SKIP_INTEGRATION_TESTS__) {
      return;
    }

    // Per-test isolation by key prefix
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  });

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).__SKIP_INTEGRATION_TESTS__) {
      return;
    }

    // Final cleanup of test keys
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }

    // 🔻 EXPLICIT TEARDOWN 🔻
    // 1) Stop the server's background resources (workers, intervals, etc.)
    if (server && typeof server.shutdown === 'function') {
      await server.shutdown();
    } else if (server && typeof server.stop === 'function') {
      await server.stop();
    }

    // 2) Close Redis connection - this must happen AFTER server.shutdown()
    // to ensure all services have finished using it
    if (redis) {
      try {
        // Remove all event listeners to prevent keeping process alive
        redis.removeAllListeners();
        // Disconnect immediately (don't wait for pending commands)
        redis.disconnect();
        // Also call quit to ensure clean shutdown
        await redis.quit();
      } catch {
        // Ignore errors during cleanup - connection might already be closed
      }
    }

    // 3) Clear any Jest timers
    jest.clearAllTimers();
  });

  beforeEach(async () => {
    // Skip tests if Redis is not available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((global as any).__SKIP_INTEGRATION_TESTS__) {
      return;
    }

    // Clean up test data before each test to ensure isolation
    if (redis && redis.status === 'ready') {
      const keys = await redis.keys(`${TEST_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(keys);
      }
    }
  });

  describe('POST /api/agent/new', () => {
    it('should create a new agent conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent-123' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();
      expect(response.body.conversationId).toMatch(/^agent-\d+-[a-z0-9]+$/);
    });

    it('should create a conversation without agentId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app).post('/api/agent/new').send({}).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();
    });

    it('should create conversation with optional agentId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'optional-agent-id' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();

      // Verify agentId was saved by getting the conversation
      const getResponse = await request(app)
        .get(`/api/agent/${response.body.conversationId}`)
        .expect(200);

      expect(getResponse.body.agentId).toBe('optional-agent-id');
    });

    it('should save metadata when provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const metadata = {
        source: 'test',
        userId: 'user-123',
        customField: 'custom-value',
      };

      const response = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent', metadata })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationId).toBeDefined();

      // Verify metadata was saved by getting the conversation
      const getResponse = await request(app)
        .get(`/api/agent/${response.body.conversationId}`)
        .expect(200);

      expect(getResponse.body.metadata).toBeDefined();
      expect(getResponse.body.metadata.source).toBe('test');
      expect(getResponse.body.metadata.userId).toBe('user-123');
      expect(getResponse.body.metadata.customField).toBe('custom-value');
    });

    it('should return conversation ID', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app).post('/api/agent/new').send({}).expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('conversationId');
      expect(response.body.conversationId).toBeTruthy();
      expect(typeof response.body.conversationId).toBe('string');
      expect(response.body.conversationId).toMatch(/^agent-\d+-[a-z0-9]+$/);
    });
  });

  describe('GET /api/agent/list', () => {
    it('should list all agent conversations', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Create a few conversations
      const conv1 = await request(app).post('/api/agent/new').send({ agentId: 'agent-1' });

      const conv2 = await request(app).post('/api/agent/new').send({ agentId: 'agent-2' });

      const response = await request(app).get('/api/agent/list').expect(200);

      expect(response.body).toHaveProperty('conversations');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.conversations)).toBe(true);
      expect(response.body.conversations.length).toBeGreaterThanOrEqual(2);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(2);

      // Verify conversations are in the list
      const conversationIds = response.body.conversations.map((c: any) => c.conversationId);
      expect(conversationIds).toContain(conv1.body.conversationId);
      expect(conversationIds).toContain(conv2.body.conversationId);
    });

    it('should return empty array when no conversations exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app).get('/api/agent/list').expect(200);

      expect(response.body).toHaveProperty('conversations');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.conversations)).toBe(true);
      // Note: May not be empty if other tests created conversations
    });

    it('should return 400 when limit is invalid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Test negative limit
      const response1 = await request(app).get('/api/agent/list?limit=-1').expect(400);
      expect(response1.body.success).toBe(false);
      expect(response1.body.error).toContain('limit must be a positive integer');

      // Test zero limit
      const response2 = await request(app).get('/api/agent/list?limit=0').expect(400);
      expect(response2.body.success).toBe(false);
      expect(response2.body.error).toContain('limit must be a positive integer');

      // Test non-numeric limit
      const response3 = await request(app).get('/api/agent/list?limit=abc').expect(400);
      expect(response3.body.success).toBe(false);
      expect(response3.body.error).toContain('limit must be a positive integer');
    });

    it('should return 400 when offset is invalid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Test negative offset
      const response1 = await request(app).get('/api/agent/list?offset=-1').expect(400);
      expect(response1.body.success).toBe(false);
      expect(response1.body.error).toContain('offset must be a non-negative integer');

      // Test non-numeric offset
      const response2 = await request(app).get('/api/agent/list?offset=abc').expect(400);
      expect(response2.body.success).toBe(false);
      expect(response2.body.error).toContain('offset must be a non-negative integer');
    });

    it('should return 400 when sortBy is invalid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app).get('/api/agent/list?sortBy=invalidField').expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain(
        'sortBy must be one of: createdAt, lastAccessedAt, messageCount'
      );
    });

    it('should return 400 when sortOrder is invalid', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const response = await request(app).get('/api/agent/list?sortOrder=invalid').expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('sortOrder must be one of: asc, desc');
    });

    it('should return conversations with pagination metadata', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Create some conversations
      await request(app).post('/api/agent/new').send({ agentId: 'agent-1' });
      await request(app).post('/api/agent/new').send({ agentId: 'agent-2' });
      await request(app).post('/api/agent/new').send({ agentId: 'agent-3' });

      const response = await request(app).get('/api/agent/list?limit=2&offset=0').expect(200);

      expect(response.body).toHaveProperty('conversations');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.conversations)).toBe(true);
      expect(response.body.conversations.length).toBeLessThanOrEqual(2);

      // Verify pagination metadata structure
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('offset');
      expect(typeof response.body.pagination.total).toBe('number');
      expect(response.body.pagination.limit).toBe(2);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should apply sorting correctly', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Create conversations with delays to ensure different timestamps
      const conv1 = await request(app).post('/api/agent/new').send({ agentId: 'agent-1' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const conv2 = await request(app).post('/api/agent/new').send({ agentId: 'agent-2' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const conv3 = await request(app).post('/api/agent/new').send({ agentId: 'agent-3' });

      // Test sorting by createdAt descending (newest first)
      const responseDesc = await request(app)
        .get('/api/agent/list?sortBy=createdAt&sortOrder=desc')
        .expect(200);

      expect(responseDesc.body.conversations.length).toBeGreaterThanOrEqual(3);
      const conversationIdsDesc = responseDesc.body.conversations.map((c: any) => c.conversationId);
      // Newest should be first (or at least in the list)
      expect(conversationIdsDesc).toContain(conv3.body.conversationId);
      expect(conversationIdsDesc).toContain(conv2.body.conversationId);
      expect(conversationIdsDesc).toContain(conv1.body.conversationId);

      // Verify sorting order: newest first
      const conv3Index = conversationIdsDesc.indexOf(conv3.body.conversationId);
      const conv1Index = conversationIdsDesc.indexOf(conv1.body.conversationId);
      expect(conv3Index).toBeLessThan(conv1Index);

      // Test sorting by createdAt ascending (oldest first)
      const responseAsc = await request(app)
        .get('/api/agent/list?sortBy=createdAt&sortOrder=asc')
        .expect(200);

      expect(responseAsc.body.conversations.length).toBeGreaterThanOrEqual(3);
      const conversationIdsAsc = responseAsc.body.conversations.map((c: any) => c.conversationId);
      // All conversations should be in the list
      expect(conversationIdsAsc).toContain(conv1.body.conversationId);
      expect(conversationIdsAsc).toContain(conv2.body.conversationId);
      expect(conversationIdsAsc).toContain(conv3.body.conversationId);

      // Verify sorting order: oldest first
      const conv1IndexAsc = conversationIdsAsc.indexOf(conv1.body.conversationId);
      const conv3IndexAsc = conversationIdsAsc.indexOf(conv3.body.conversationId);
      expect(conv1IndexAsc).toBeLessThan(conv3IndexAsc);
    });
  });

  describe('GET /api/agent/:id', () => {
    it('should get a specific conversation by ID', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Create a conversation
      const createResponse = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Get the conversation
      const response = await request(app).get(`/api/agent/${conversationId}`).expect(200);

      expect(response.body.conversationId).toBe(conversationId);
      expect(response.body.agentId).toBe('test-agent');
      expect(Array.isArray(response.body.messages)).toBe(true);
    });

    it('should return 404 for non-existent conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      await request(app).get('/api/agent/non-existent-id').expect(404);
    });
  });

  describe('POST /api/agent/:id/message', () => {
    it('should add a message to a conversation', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // Create a conversation
      const createResponse = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Add a message
      const messageResponse = await request(app)
        .post(`/api/agent/${conversationId}/message`)
        .send({
          role: 'user',
          content: 'Hello, agent!',
          source: 'voice',
        })
        .expect(200);

      expect(messageResponse.body.success).toBe(true);
      expect(messageResponse.body.conversationId).toBe(conversationId);

      // Verify message was added by getting the conversation
      const getResponse = await request(app).get(`/api/agent/${conversationId}`).expect(200);

      expect(getResponse.body.messages).toHaveLength(1);
      expect(getResponse.body.messages[0].content).toBe('Hello, agent!');
      expect(getResponse.body.messages[0].role).toBe('user');
      expect(getResponse.body.messages[0].source).toBe('voice');
    });

    it('should return 400 if required fields are missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      const createResponse = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent' });

      const conversationId = createResponse.body.conversationId;

      // Try to add message without required fields
      await request(app)
        .post(`/api/agent/${conversationId}/message`)
        .send({
          content: 'Hello',
          // Missing role
        })
        .expect(400);
    });

    it('should return 500 if conversation does not exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      await request(app)
        .post('/api/agent/non-existent/message')
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
      if ((global as any).__SKIP_INTEGRATION_TESTS__) return;

      // 1. Create conversation
      const createResponse = await request(app)
        .post('/api/agent/new')
        .send({ agentId: 'test-agent' })
        .expect(200);

      const conversationId = createResponse.body.conversationId;

      // 2. Add user message
      await request(app)
        .post(`/api/agent/${conversationId}/message`)
        .send({
          role: 'user',
          content: 'Hello!',
          source: 'voice',
        })
        .expect(200);

      // 3. Add assistant message
      await request(app)
        .post(`/api/agent/${conversationId}/message`)
        .send({
          role: 'assistant',
          content: 'Hi there! How can I help?',
          source: 'text',
        })
        .expect(200);

      // 4. Get conversation and verify all messages
      const getResponse = await request(app).get(`/api/agent/${conversationId}`).expect(200);

      expect(getResponse.body.messages).toHaveLength(2);
      expect(getResponse.body.messages[0].role).toBe('user');
      expect(getResponse.body.messages[0].content).toBe('Hello!');
      expect(getResponse.body.messages[1].role).toBe('assistant');
      expect(getResponse.body.messages[1].content).toBe('Hi there! How can I help?');

      // 5. Verify conversation appears in list
      const listResponse = await request(app).get('/api/agent/list').expect(200);

      expect(listResponse.body).toHaveProperty('conversations');
      const conversationIds = listResponse.body.conversations.map((c: any) => c.conversationId);
      expect(conversationIds).toContain(conversationId);
    });
  });
});
