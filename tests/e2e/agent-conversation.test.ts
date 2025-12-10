// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Server } from '../../src/server.js';
import { createMockRedisClient } from '../test-utils.js';
import type Redis from 'ioredis';
import { createTestCleanup } from '../test-utils.js';

describe('E2E: Agent Conversation Flow', () => {
  let server: Server;
  let app: any;
  let redisClient: Partial<Redis>;

  beforeEach(() => {
    // Create a mock Redis client
    redisClient = createMockRedisClient({ initialStatus: 'ready' }) as unknown as Redis;

    // Create server with mocked Redis
    server = new Server(redisClient as Redis);
    app = server.app;

    // The AgentConversationService constructor sets redisAvailable = true when Redis is injected
    // So it should already be available, but let's verify
    // The service checks redisAvailable before operations, so we need to ensure it's true
  });

  afterEach(async () => {
    // Clean up server
    if (server) {
      const cleanup = await createTestCleanup(server);
      await cleanup.cleanup();
    }
  });

  it('should complete full flow: POST /api/agent/new → POST /api/agent/:id/message → GET /api/agent/:id', async () => {
    // Step 1: Create a new agent conversation
    const newConversationResponse = await request(app)
      .post('/api/agent/new')
      .send({
        agentId: 'test-agent',
        metadata: {
          test: 'metadata',
        },
      })
      .expect(200);

    // Verify conversation creation
    expect(newConversationResponse.body).toMatchObject({
      success: true,
      message: 'New agent conversation created',
    });
    expect(newConversationResponse.body.conversationId).toBeDefined();
    const conversationId = newConversationResponse.body.conversationId;

    // Step 2: Add a message to the conversation
    const messageResponse = await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'user',
        content: 'Hello, this is a test message for agent conversation',
        source: 'text',
      })
      .expect(200);

    // Verify message was added
    expect(messageResponse.body).toMatchObject({
      success: true,
      message: 'Message added to conversation',
      conversationId,
    });

    // Step 3: Get the conversation to verify state
    const getConversationResponse = await request(app)
      .get(`/api/agent/${conversationId}`)
      .expect(200);

    // Verify conversation retrieval
    expect(getConversationResponse.body).toBeDefined();
    expect(getConversationResponse.body.conversationId).toBe(conversationId);
    expect(getConversationResponse.body.messages).toBeDefined();
    expect(Array.isArray(getConversationResponse.body.messages)).toBe(true);

    // Verify conversation has at least one message
    expect(getConversationResponse.body.messages.length).toBeGreaterThan(0);

    // Verify the message content
    const userMessage = getConversationResponse.body.messages.find(
      (msg: { role: string }) => msg.role === 'user'
    );
    expect(userMessage).toBeDefined();
    expect(userMessage.content).toContain('Hello, this is a test message for agent conversation');
    expect(userMessage.source).toBe('text');
  });

  it('should verify conversation creation with optional fields', async () => {
    // Create a new agent conversation without optional fields
    const newConversationResponse = await request(app)
      .post('/api/agent/new')
      .send({})
      .expect(200);

    expect(newConversationResponse.body).toMatchObject({
      success: true,
      conversationId: expect.any(String),
    });
  });

  it('should verify message addition with different roles', async () => {
    // Create a new agent conversation
    const newConversationResponse = await request(app)
      .post('/api/agent/new')
      .send({
        agentId: 'test-agent',
      })
      .expect(200);

    const conversationId = newConversationResponse.body.conversationId;

    // Add user message
    await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'user',
        content: 'User message',
      })
      .expect(200);

    // Add assistant message
    await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'assistant',
        content: 'Assistant response',
      })
      .expect(200);

    // Get conversation and verify both messages
    const getConversationResponse = await request(app)
      .get(`/api/agent/${conversationId}`)
      .expect(200);

    expect(getConversationResponse.body.messages.length).toBeGreaterThanOrEqual(2);

    const userMessage = getConversationResponse.body.messages.find(
      (msg: { role: string }) => msg.role === 'user'
    );
    const assistantMessage = getConversationResponse.body.messages.find(
      (msg: { role: string }) => msg.role === 'assistant'
    );

    expect(userMessage).toBeDefined();
    expect(assistantMessage).toBeDefined();
    expect(userMessage.content).toContain('User message');
    expect(assistantMessage.content).toContain('Assistant response');
  });

  it('should return 404 for non-existent conversation', async () => {
    const nonExistentId = 'non-existent-agent-conversation-id-12345';

    const response = await request(app)
      .get(`/api/agent/${nonExistentId}`)
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      error: 'Agent conversation not found',
    });
  });

  it('should return 400 for missing required fields in message', async () => {
    // Create a new agent conversation
    const newConversationResponse = await request(app)
      .post('/api/agent/new')
      .send({
        agentId: 'test-agent',
      })
      .expect(200);

    const conversationId = newConversationResponse.body.conversationId;

    // Try to add message without role
    const response1 = await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        content: 'Message without role',
      })
      .expect(400);

    expect(response1.body).toMatchObject({
      success: false,
      error: expect.stringContaining('Missing required fields'),
    });

    // Try to add message without content
    const response2 = await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'user',
      })
      .expect(400);

    expect(response2.body).toMatchObject({
      success: false,
      error: expect.stringContaining('Missing required fields'),
    });
  });

  it('should verify conversation state management with multiple messages', async () => {
    // Create a new agent conversation
    const newConversationResponse = await request(app)
      .post('/api/agent/new')
      .send({
        agentId: 'test-agent',
      })
      .expect(200);

    const conversationId = newConversationResponse.body.conversationId;

    // Add multiple messages
    await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'user',
        content: 'First message',
      })
      .expect(200);

    await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'assistant',
        content: 'First response',
      })
      .expect(200);

    await request(app)
      .post(`/api/agent/${conversationId}/message`)
      .send({
        role: 'user',
        content: 'Second message',
      })
      .expect(200);

    // Get conversation and verify state
    const getConversationResponse = await request(app)
      .get(`/api/agent/${conversationId}`)
      .expect(200);

    // Verify conversation has all messages
    expect(getConversationResponse.body.messages.length).toBeGreaterThanOrEqual(3);

    // Verify messages are in order (most recent last)
    const messages = getConversationResponse.body.messages;
    expect(messages[messages.length - 1].content).toContain('Second message');
  });
});

