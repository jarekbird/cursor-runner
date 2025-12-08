/**
 * Tests for test utility helpers
 */
import { describe, it, expect } from '@jest/globals';
import { createMockRedisClient } from './test-utils.js';

describe('createMockRedisClient', () => {
  describe('basic operations', () => {
    it('should return a mock Redis client with all required methods', () => {
      const mockRedis = createMockRedisClient();

      expect(mockRedis).toBeDefined();
      expect(typeof mockRedis.get).toBe('function');
      expect(typeof mockRedis.set).toBe('function');
      expect(typeof mockRedis.setex).toBe('function');
      expect(typeof mockRedis.smembers).toBe('function');
      expect(typeof mockRedis.sadd).toBe('function');
      expect(typeof mockRedis.srem).toBe('function');
      expect(typeof mockRedis.del).toBe('function');
      expect(typeof mockRedis.exists).toBe('function');
      expect(typeof mockRedis.expire).toBe('function');
      expect(typeof mockRedis.keys).toBe('function');
      expect(typeof mockRedis.quit).toBe('function');
      expect(typeof mockRedis.disconnect).toBe('function');
    });

    it('should have status property', () => {
      const mockRedis = createMockRedisClient();
      expect(mockRedis.status).toBe('ready');
    });

    it('should allow setting initial status', () => {
      const mockRedis = createMockRedisClient({ initialStatus: 'connecting' });
      expect(mockRedis.status).toBe('connecting');
    });
  });

  describe('get and set operations', () => {
    it('should return null for non-existent keys', async () => {
      const mockRedis = createMockRedisClient();
      const value = await mockRedis.get!('nonexistent');
      expect(value).toBeNull();
    });

    it('should set and get values correctly', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const value = await mockRedis.get!('key1');
      expect(value).toBe('value1');
    });

    it('should overwrite existing values', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      await mockRedis.set!('key1', 'value2');
      const value = await mockRedis.get!('key1');
      expect(value).toBe('value2');
    });
  });

  describe('setex operations', () => {
    it('should set key with expiration', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.setex!('key1', 1, 'value1');
      const value = await mockRedis.get!('key1');
      expect(value).toBe('value1');
    });

    it('should expire keys after specified time', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.setex!('key1', 0.1, 'value1'); // 100ms expiration

      // Should exist immediately
      const value1 = await mockRedis.get!('key1');
      expect(value1).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be null after expiration
      const value2 = await mockRedis.get!('key1');
      expect(value2).toBeNull();
    });
  });

  describe('set operations (smembers, sadd, srem)', () => {
    it('should return empty array for non-existent set keys', async () => {
      const mockRedis = createMockRedisClient();
      const members = await mockRedis.smembers!('nonexistent');
      expect(members).toEqual([]);
    });

    it('should add members to set and retrieve them', async () => {
      const mockRedis = createMockRedisClient();
      const added = await mockRedis.sadd!('set1', 'member1', 'member2', 'member3');
      expect(added).toBe(3);

      const members = await mockRedis.smembers!('set1');
      expect(members).toHaveLength(3);
      expect(members).toContain('member1');
      expect(members).toContain('member2');
      expect(members).toContain('member3');
    });

    it('should not add duplicate members', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1');
      const added = await mockRedis.sadd!('set1', 'member1');
      expect(added).toBe(0);

      const members = await mockRedis.smembers!('set1');
      expect(members).toHaveLength(1);
      expect(members).toContain('member1');
    });

    it('should remove members from set', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1', 'member2', 'member3');
      const removed = await mockRedis.srem!('set1', 'member2');
      expect(removed).toBe(1);

      const members = await mockRedis.smembers!('set1');
      expect(members).toHaveLength(2);
      expect(members).toContain('member1');
      expect(members).toContain('member3');
      expect(members).not.toContain('member2');
    });

    it('should return 0 when removing non-existent members', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1');
      const removed = await mockRedis.srem!('set1', 'member2');
      expect(removed).toBe(0);
    });

    it('should delete set when all members are removed', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1');
      await mockRedis.srem!('set1', 'member1');
      const members = await mockRedis.smembers!('set1');
      expect(members).toEqual([]);
    });
  });

  describe('del operation', () => {
    it('should delete string keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const deleted = await mockRedis.del!('key1');
      expect(deleted).toBe(1);

      const value = await mockRedis.get!('key1');
      expect(value).toBeNull();
    });

    it('should delete set keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1');
      const deleted = await mockRedis.del!('set1');
      expect(deleted).toBe(1);

      const members = await mockRedis.smembers!('set1');
      expect(members).toEqual([]);
    });

    it('should return 0 when deleting non-existent keys', async () => {
      const mockRedis = createMockRedisClient();
      const deleted = await mockRedis.del!('nonexistent');
      expect(deleted).toBe(0);
    });

    it('should delete multiple keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      await mockRedis.set!('key2', 'value2');
      const deleted = await mockRedis.del!('key1', 'key2');
      expect(deleted).toBe(2);
    });
  });

  describe('exists operation', () => {
    it('should return 1 for existing string keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const exists = await mockRedis.exists!('key1');
      expect(exists).toBe(1);
    });

    it('should return 1 for existing set keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('set1', 'member1');
      const exists = await mockRedis.exists!('set1');
      expect(exists).toBe(1);
    });

    it('should return 0 for non-existent keys', async () => {
      const mockRedis = createMockRedisClient();
      const exists = await mockRedis.exists!('nonexistent');
      expect(exists).toBe(0);
    });

    it('should return 0 for expired keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.setex!('key1', 0.1, 'value1');
      await new Promise((resolve) => setTimeout(resolve, 150));
      const exists = await mockRedis.exists!('key1');
      expect(exists).toBe(0);
    });

    it('should count multiple existing keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      await mockRedis.set!('key2', 'value2');
      const count = await mockRedis.exists!('key1', 'key2', 'key3');
      expect(count).toBe(2);
    });
  });

  describe('expire operation', () => {
    it('should set expiration on existing keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const result = await mockRedis.expire!('key1', 0.1);
      expect(result).toBe(1);

      // Should exist immediately
      const value1 = await mockRedis.get!('key1');
      expect(value1).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be null after expiration
      const value2 = await mockRedis.get!('key1');
      expect(value2).toBeNull();
    });

    it('should return 0 for non-existent keys', async () => {
      const mockRedis = createMockRedisClient();
      const result = await mockRedis.expire!('nonexistent', 10);
      expect(result).toBe(0);
    });
  });

  describe('keys operation', () => {
    it('should return all keys matching pattern', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('cursor:conversation:1', 'value1');
      await mockRedis.set!('cursor:conversation:2', 'value2');
      await mockRedis.set!('cursor:other:1', 'value3');

      const keys = await mockRedis.keys!('cursor:conversation:*');
      expect(keys).toHaveLength(2);
      expect(keys).toContain('cursor:conversation:1');
      expect(keys).toContain('cursor:conversation:2');
    });

    it('should return empty array when no keys match', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const keys = await mockRedis.keys!('nonexistent:*');
      expect(keys).toEqual([]);
    });

    it('should include set keys in results', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.sadd!('agent:conversations:list', 'id1');
      const keys = await mockRedis.keys!('agent:conversations:list');
      expect(keys).toContain('agent:conversations:list');
    });

    it('should not include expired keys', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.setex!('cursor:conversation:1', 0.1, 'value1');
      await mockRedis.set!('cursor:conversation:2', 'value2');

      await new Promise((resolve) => setTimeout(resolve, 150));

      const keys = await mockRedis.keys!('cursor:conversation:*');
      expect(keys).toHaveLength(1);
      expect(keys).toContain('cursor:conversation:2');
    });
  });

  describe('connection failure simulation', () => {
    it('should reject all operations when connection failure is simulated', async () => {
      const mockRedis = createMockRedisClient({ simulateConnectionFailure: true });

      await expect(mockRedis.get!('key1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.set!('key1', 'value1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.setex!('key1', 10, 'value1')).rejects.toThrow(
        'Redis connection failed'
      );
      await expect(mockRedis.smembers!('set1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.sadd!('set1', 'member1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.srem!('set1', 'member1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.del!('key1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.exists!('key1')).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.expire!('key1', 10)).rejects.toThrow('Redis connection failed');
      await expect(mockRedis.keys!('*')).rejects.toThrow('Redis connection failed');
    });

    it('should reject operations when status is close', async () => {
      const mockRedis = createMockRedisClient({ initialStatus: 'close' });

      await expect(mockRedis.get!('key1')).rejects.toThrow('Redis connection failed');
    });
  });

  describe('quit and disconnect', () => {
    it('should quit without errors', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      const result = await mockRedis.quit!();
      expect(result).toBe('OK');
      expect(mockRedis.status).toBe('end');
    });

    it('should disconnect without errors', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      await mockRedis.disconnect!();
      expect(mockRedis.status).toBe('end');
    });

    it('should clear storage on quit', async () => {
      const mockRedis = createMockRedisClient();
      await mockRedis.set!('key1', 'value1');
      await mockRedis.sadd!('set1', 'member1');
      await mockRedis.quit!();

      const value = await mockRedis.get!('key1');
      expect(value).toBeNull();
      const members = await mockRedis.smembers!('set1');
      expect(members).toEqual([]);
    });
  });

  describe('state isolation', () => {
    it('should not share state between instances', async () => {
      const mockRedis1 = createMockRedisClient();
      const mockRedis2 = createMockRedisClient();

      await mockRedis1.set!('key1', 'value1');
      const value2 = await mockRedis2.get!('key1');
      expect(value2).toBeNull();
    });

    it('should maintain separate state for each instance', async () => {
      const mockRedis1 = createMockRedisClient();
      const mockRedis2 = createMockRedisClient();

      await mockRedis1.set!('key1', 'value1');
      await mockRedis2.set!('key1', 'value2');

      const value1 = await mockRedis1.get!('key1');
      const value2 = await mockRedis2.get!('key1');

      expect(value1).toBe('value1');
      expect(value2).toBe('value2');
    });
  });
});
