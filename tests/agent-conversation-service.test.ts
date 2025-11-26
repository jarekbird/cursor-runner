// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AgentConversationService } from '../src/agent-conversation-service.js';
import type Redis from 'ioredis';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      sadd: jest.fn(),
      smembers: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
      connect: jest.fn<() => Promise<void>>().mockImplementation(() => Promise.resolve()),
      on: jest.fn(),
      quit: jest.fn<() => Promise<void>>().mockImplementation(() => Promise.resolve()),
      status: 'ready',
    };
    return mockRedis;
  });
});

describe('AgentConversationService', () => {
  let service: AgentConversationService;
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a fresh mock Redis instance
    let connectHandler: (() => void) | undefined;
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      sadd: jest.fn(),
      smembers: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
      connect: jest.fn<() => Promise<void>>().mockImplementation(async () => {
        // Simulate connection by calling the connect handler immediately
        if (connectHandler) {
          connectHandler();
        }
        return Promise.resolve();
      }),
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'connect') {
          connectHandler = handler;
          // Fire the connect event immediately to set redisAvailable
          process.nextTick(() => handler());
        }
      }),
      quit: jest.fn<() => Promise<void>>().mockImplementation(() => Promise.resolve()),
      status: 'ready',
    };
    
    // Replace the Redis constructor to return our mock
    const RedisMock = jest.requireMock('ioredis') as jest.MockedClass<typeof Redis>;
    (RedisMock as unknown as jest.Mock).mockImplementation(() => mockRedis);
    
    service = new AgentConversationService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createConversation', () => {
    it('should create a new agent conversation', async () => {
      const conversationId = 'agent-1234567890-abc123';
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const conversation = await service.createConversation('agent-123');

      expect(conversation).toBeDefined();
      expect(conversation.conversationId).toMatch(/^agent-\d+-[a-z0-9]+$/);
      expect(conversation.agentId).toBe('agent-123');
      expect(conversation.messages).toEqual([]);
      expect(conversation.status).toBe('active');
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(mockRedis.sadd).toHaveBeenCalled();
    });

    it('should create a conversation without agentId', async () => {
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      const conversation = await service.createConversation();

      expect(conversation).toBeDefined();
      expect(conversation.agentId).toBeUndefined();
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(mockRedis.sadd).toHaveBeenCalled();
    });
  });

  describe('getConversation', () => {
    it('should get an existing conversation', async () => {
      const conversationId = 'agent-1234567890-abc123';
      const conversationData = {
        conversationId,
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
        agentId: 'agent-123',
        status: 'active',
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(conversationData));
      mockRedis.setex.mockResolvedValue('OK');

      const conversation = await service.getConversation(conversationId);

      expect(conversation).toBeDefined();
      expect(conversation?.conversationId).toBe(conversationId);
      expect(conversation?.agentId).toBe('agent-123');
      expect(mockRedis.get).toHaveBeenCalledWith(`agent:conversation:${conversationId}`);
      expect(mockRedis.setex).toHaveBeenCalled(); // Should update lastAccessedAt
    });

    it('should return null for non-existent conversation', async () => {
      mockRedis.get.mockResolvedValue(null);

      const conversation = await service.getConversation('non-existent');

      expect(conversation).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('agent:conversation:non-existent');
    });

    it('should handle backward compatibility with old data format', async () => {
      const conversationId = 'agent-1234567890-abc123';
      // Old format without conversationId field
      const oldFormatData = {
        id: conversationId,
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(oldFormatData));
      mockRedis.setex.mockResolvedValue('OK');

      const conversation = await service.getConversation(conversationId);

      expect(conversation).toBeDefined();
      expect(conversation?.conversationId).toBe(conversationId);
    });
  });

  describe('listConversations', () => {
    it('should list all agent conversations', async () => {
      const conversationIds = ['agent-1', 'agent-2'];
      const conversation1 = {
        conversationId: 'agent-1',
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-02T00:00:00Z',
      };
      const conversation2 = {
        conversationId: 'agent-2',
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
      };

      mockRedis.smembers.mockResolvedValue(conversationIds);
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(conversation1))
        .mockResolvedValueOnce(JSON.stringify(conversation2));
      mockRedis.setex.mockResolvedValue('OK');

      const conversations = await service.listConversations();

      expect(conversations).toHaveLength(2);
      expect(conversations[0].conversationId).toBe('agent-1'); // Should be sorted by lastAccessedAt descending
      expect(conversations[1].conversationId).toBe('agent-2');
      expect(mockRedis.smembers).toHaveBeenCalledWith('agent:conversations:list');
    });

    it('should return empty array when no conversations exist', async () => {
      mockRedis.smembers.mockResolvedValue([]);

      const conversations = await service.listConversations();

      expect(conversations).toEqual([]);
    });
  });

  describe('addMessage', () => {
    it('should add a message to a conversation', async () => {
      const conversationId = 'agent-1234567890-abc123';
      const existingConversation = {
        conversationId,
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(existingConversation));
      mockRedis.setex.mockResolvedValue('OK');

      const message = {
        role: 'user' as const,
        content: 'Hello, agent!',
        timestamp: '2025-01-01T01:00:00Z',
        source: 'voice' as const,
      };

      await service.addMessage(conversationId, message);

      expect(mockRedis.get).toHaveBeenCalledWith(`agent:conversation:${conversationId}`);
      expect(mockRedis.setex).toHaveBeenCalled();
      
      // Verify the message was added
      const setexCall = mockRedis.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.messages).toHaveLength(1);
      expect(savedData.messages[0].content).toBe('Hello, agent!');
      expect(savedData.messages[0].messageId).toBeDefined();
    });

    it('should generate messageId if not provided', async () => {
      const conversationId = 'agent-1234567890-abc123';
      const existingConversation = {
        conversationId,
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(existingConversation));
      mockRedis.setex.mockResolvedValue('OK');

      const message = {
        role: 'user' as const,
        content: 'Test message',
        timestamp: '2025-01-01T01:00:00Z',
      };

      await service.addMessage(conversationId, message);

      const setexCall = mockRedis.setex.mock.calls[0];
      const savedData = JSON.parse(setexCall[2]);
      expect(savedData.messages[0].messageId).toBeDefined();
      expect(savedData.messages[0].messageId).toMatch(/^msg-\d+-[a-z0-9]+$/);
    });

    it('should throw error if conversation does not exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const message = {
        role: 'user' as const,
        content: 'Test message',
        timestamp: '2025-01-01T01:00:00Z',
      };

      await expect(service.addMessage('non-existent', message)).rejects.toThrow(
        'Agent conversation non-existent not found'
      );
    });
  });

  describe('updateConversation', () => {
    it('should update an existing conversation', async () => {
      const conversation = {
        conversationId: 'agent-1234567890-abc123',
        messages: [],
        createdAt: '2025-01-01T00:00:00Z',
        lastAccessedAt: '2025-01-01T00:00:00Z',
        metadata: { key: 'value' },
      };

      mockRedis.setex.mockResolvedValue('OK');

      await service.updateConversation(conversation);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `agent:conversation:${conversation.conversationId}`,
        3600,
        JSON.stringify(conversation)
      );
    });
  });
});

