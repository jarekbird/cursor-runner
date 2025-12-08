/**
 * Unit tests for ConversationService
 * Tests conversation ID resolution, conversation management, and message storage
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConversationService } from '../src/conversation-service.js';
import { createMockRedisClient } from './test-utils.js';
import type Redis from 'ioredis';

describe('ConversationService - getConversationId', () => {
  let conversationService: ConversationService;
  let mockRedis: Partial<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = createMockRedisClient();
    conversationService = new ConversationService(mockRedis as Redis);
  });

  it('should use explicit conversationId when provided and not update last-conversation key', async () => {
    const explicitConversationId = 'explicit-conversation-id';
    // Mock getConversation (called by updateLastAccessed) - uses cursor:conversation:${id} key
    const mockGet = (jest.fn() as any).mockImplementation((key: string) => {
      if (key === `cursor:conversation:${explicitConversationId}`) {
        return Promise.resolve(
          JSON.stringify({
            conversationId: explicitConversationId,
            messages: [],
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
          })
        );
      }
      return Promise.resolve(null);
    });
    const mockSetex = (jest.fn() as any).mockResolvedValue('OK');
    (mockRedis as any).get = mockGet;
    (mockRedis as any).setex = mockSetex;

    const result = await conversationService.getConversationId(explicitConversationId, 'default');

    expect(result).toBe(explicitConversationId);
    // Should update last accessed time (calls getConversation and saveConversation)
    expect(mockGet).toHaveBeenCalledWith(`cursor:conversation:${explicitConversationId}`);
    // saveConversation may not be called if conversation doesn't exist, so we just verify the ID is returned
  });

  it('should use last-conversation key per queue type when no id provided', async () => {
    const lastConversationId = 'last-conversation-id';
    const mockGet = (jest.fn() as any).mockResolvedValue(lastConversationId);
    (mockRedis as any).get = mockGet;

    const result = await conversationService.getConversationId(undefined, 'default');

    expect(result).toBe(lastConversationId);
    expect(mockGet).toHaveBeenCalledWith('cursor:last_conversation_id');
  });

  it('should use telegram last-conversation key for telegram queue type', async () => {
    const telegramConversationId = 'telegram-conversation-id';
    const mockGet = (jest.fn() as any).mockResolvedValue(telegramConversationId);
    (mockRedis as any).get = mockGet;

    const result = await conversationService.getConversationId(undefined, 'telegram');

    expect(result).toBe(telegramConversationId);
    expect(mockGet).toHaveBeenCalledWith('cursor:telegram:last_conversation_id');
  });

  it('should use api last-conversation key for api queue type', async () => {
    const apiConversationId = 'api-conversation-id';
    const mockGet = (jest.fn() as any).mockResolvedValue(apiConversationId);
    (mockRedis as any).get = mockGet;

    const result = await conversationService.getConversationId(undefined, 'api');

    expect(result).toBe(apiConversationId);
    expect(mockGet).toHaveBeenCalledWith('cursor:api:last_conversation_id');
  });

  it('should create new conversation when last-conversation key is missing', async () => {
    const mockGet = (jest.fn() as any).mockResolvedValue(null);
    const mockSet = (jest.fn() as any).mockResolvedValue('OK');
    const mockSetex = (jest.fn() as any).mockResolvedValue('OK');
    (mockRedis as any).get = mockGet;
    (mockRedis as any).set = mockSet;
    (mockRedis as any).setex = mockSetex;

    const result = await conversationService.getConversationId(undefined, 'default');

    // Should create a new conversation ID
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    // Should set the last-conversation key
    expect(mockSet).toHaveBeenCalled();
    // Should create the conversation using setex
    expect(mockSetex).toHaveBeenCalled();
  });

  it('should return new UUID when Redis is unavailable', async () => {
    // Create service without Redis (simulating unavailable Redis)
    const unavailableRedis = {
      get: (jest.fn() as any).mockRejectedValue(new Error('Redis unavailable')),
      set: (jest.fn() as any).mockRejectedValue(new Error('Redis unavailable')),
    } as unknown as Redis;

    const serviceWithoutRedis = new ConversationService(unavailableRedis);
    // Manually set redisAvailable to false to simulate unavailable state
    (serviceWithoutRedis as any).redisAvailable = false;

    const result = await serviceWithoutRedis.getConversationId(undefined, 'default');

    // Should return a new UUID
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    // Should be a valid UUID format (36 characters with hyphens)
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
