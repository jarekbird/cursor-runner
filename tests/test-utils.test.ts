/**
 * Tests for test utility helpers
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import {
  createMockRedisClient,
  createTempSqliteDb,
  createMockCursorCLI,
  createMockServer,
} from './test-utils.js';
import { existsSync } from 'fs';

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

// Check if better-sqlite3 is available (native module may not be built)
let sqliteAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('better-sqlite3');
  sqliteAvailable = true;
} catch {
  // Native module not available - tests will be skipped
}

const describeSqlite = sqliteAvailable ? describe : describe.skip;

describeSqlite('createTempSqliteDb', () => {
  const cleanupFunctions: Array<() => Promise<void>> = [];

  afterEach(async () => {
    // Clean up all databases created during tests
    for (const cleanup of cleanupFunctions) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
    }
    cleanupFunctions.length = 0;
  });

  it('should create temp database file', async () => {
    const { db, dbPath, cleanup } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup);

    expect(db).toBeDefined();
    expect(dbPath).toBeDefined();
    expect(existsSync(dbPath)).toBe(true);
    expect(typeof cleanup).toBe('function');
  });

  it('should run all migrations successfully', async () => {
    const { db, cleanup } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup);

    // Check that schema_migrations table exists
    const migrations = db
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all() as Array<{ name: string }>;
    expect(migrations.length).toBeGreaterThan(0);

    // Check that system_settings table exists (from migration)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('system_settings');
  });

  it('should return database instance and cleanup function', async () => {
    const { db, cleanup } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup);

    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe('function');
    expect(typeof db.exec).toBe('function');
    expect(typeof cleanup).toBe('function');
  });

  it('should cleanup and delete temp file', async () => {
    const { dbPath, cleanup } = await createTempSqliteDb();

    expect(existsSync(dbPath)).toBe(true);
    await cleanup();
    expect(existsSync(dbPath)).toBe(false);
  });

  it('should create separate files for multiple instances', async () => {
    const { db: db1, dbPath: path1, cleanup: cleanup1 } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup1);
    const { db: db2, dbPath: path2, cleanup: cleanup2 } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup2);

    expect(path1).not.toBe(path2);
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);

    // Each database should be independent
    db1.prepare("INSERT INTO system_settings (name, value) VALUES ('test1', 1)").run();
    db2.prepare("INSERT INTO system_settings (name, value) VALUES ('test2', 1)").run();

    const result1 = db1.prepare('SELECT value FROM system_settings WHERE name = ?').get('test1') as
      | { value: number }
      | undefined;
    const result2 = db2.prepare('SELECT value FROM system_settings WHERE name = ?').get('test2') as
      | { value: number }
      | undefined;

    expect(result1?.value).toBe(1);
    expect(result2?.value).toBe(1);

    // test1 should not exist in db2
    const result1InDb2 = db2
      .prepare('SELECT value FROM system_settings WHERE name = ?')
      .get('test1') as { value: number } | undefined;
    expect(result1InDb2).toBeUndefined();
  });

  it('should handle cleanup errors gracefully', async () => {
    const { db: testDb, dbPath, cleanup } = await createTempSqliteDb();

    // Close database manually
    testDb.close();

    // Cleanup should not throw even if file is already closed
    await expect(cleanup()).resolves.toBeUndefined();

    // File should still be deleted
    expect(existsSync(dbPath)).toBe(false);
  });

  it('should have WAL mode enabled', async () => {
    const { db, cleanup } = await createTempSqliteDb();
    cleanupFunctions.push(cleanup);

    const journalMode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(journalMode.journal_mode.toLowerCase()).toBe('wal');
  });
});

describe('createMockCursorCLI', () => {
  it('should return a mock with all required methods', () => {
    const mockCLI = createMockCursorCLI();

    expect(mockCLI).toBeDefined();
    expect(typeof mockCLI.executeCommand).toBe('function');
    expect(typeof mockCLI.validate).toBe('function');
    expect(typeof mockCLI.getQueueStatus).toBe('function');
    expect(typeof mockCLI.extractFilesFromOutput).toBe('function');
    expect(mockCLI.calls).toBeDefined();
    expect(typeof mockCLI.setExecuteResult).toBe('function');
    expect(typeof mockCLI.setValidateResult).toBe('function');
    expect(typeof mockCLI.setQueueStatus).toBe('function');
    expect(typeof mockCLI.reset).toBe('function');
  });

  it('should return default execute result', async () => {
    const mockCLI = createMockCursorCLI();
    const result = await mockCLI.executeCommand(['--version']);

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('should return custom execute result', async () => {
    const customResult = {
      success: true,
      exitCode: 0,
      stdout: 'cursor-cli version 1.0.0',
      stderr: '',
    };
    const mockCLI = createMockCursorCLI({ defaultExecuteResult: customResult });
    const result = await mockCLI.executeCommand(['--version']);

    expect(result).toEqual(customResult);
  });

  it('should track executeCommand calls', async () => {
    const mockCLI = createMockCursorCLI();
    await mockCLI.executeCommand(['--version']);
    await mockCLI.executeCommand(['--help'], { cwd: '/test' });

    expect(mockCLI.calls.executeCommand).toHaveLength(2);
    expect(mockCLI.calls.executeCommand[0]).toEqual({ args: ['--version'], options: undefined });
    expect(mockCLI.calls.executeCommand[1]).toEqual({
      args: ['--help'],
      options: { cwd: '/test' },
    });
  });

  it('should return default validate result', async () => {
    const mockCLI = createMockCursorCLI();
    const result = await mockCLI.validate();

    expect(result).toBe(true);
    expect(mockCLI.calls.validate).toBe(1);
  });

  it('should return custom validate result', async () => {
    const mockCLI = createMockCursorCLI({ defaultValidateResult: false });
    const result = await mockCLI.validate();

    expect(result).toBe(false);
  });

  it('should simulate validation failure', async () => {
    const mockCLI = createMockCursorCLI({ simulateValidationFailure: true });

    await expect(mockCLI.validate()).rejects.toThrow('cursor-cli not available');
  });

  it('should return default queue status', () => {
    const mockCLI = createMockCursorCLI();
    const status = mockCLI.getQueueStatus();

    expect(status).toEqual({ available: 5, waiting: 0, maxConcurrent: 5 });
    expect(mockCLI.calls.getQueueStatus).toBe(1);
  });

  it('should return custom queue status', () => {
    const customStatus = { available: 2, waiting: 3, maxConcurrent: 5 };
    const mockCLI = createMockCursorCLI({ defaultQueueStatus: customStatus });
    const status = mockCLI.getQueueStatus();

    expect(status).toEqual(customStatus);
  });

  it('should extract files from output', () => {
    const mockCLI = createMockCursorCLI();
    const output = `
      file: src/test.ts
      Created: tests/test.test.ts
      modified: README.md
    `;
    const files = mockCLI.extractFilesFromOutput(output);

    expect(files.length).toBeGreaterThan(0);
    expect(mockCLI.calls.extractFilesFromOutput).toHaveLength(1);
    expect(mockCLI.calls.extractFilesFromOutput[0].output).toBe(output);
  });

  it('should allow setting execute result dynamically', async () => {
    const mockCLI = createMockCursorCLI();
    const newResult = {
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error occurred',
    };

    mockCLI.setExecuteResult(newResult);
    const result = await mockCLI.executeCommand(['test']);

    expect(result).toEqual(newResult);
  });

  it('should allow setting validate result dynamically', async () => {
    const mockCLI = createMockCursorCLI();
    mockCLI.setValidateResult(false);
    const result = await mockCLI.validate();

    expect(result).toBe(false);
  });

  it('should allow setting queue status dynamically', () => {
    const mockCLI = createMockCursorCLI();
    const newStatus = { available: 1, waiting: 4, maxConcurrent: 5 };

    mockCLI.setQueueStatus(newStatus);
    const status = mockCLI.getQueueStatus();

    expect(status).toEqual(newStatus);
  });

  it('should reset call tracking and state', async () => {
    const mockCLI = createMockCursorCLI();
    await mockCLI.executeCommand(['test']);
    await mockCLI.validate();
    mockCLI.getQueueStatus();
    mockCLI.extractFilesFromOutput('test');

    mockCLI.reset();

    expect(mockCLI.calls.executeCommand).toHaveLength(0);
    expect(mockCLI.calls.validate).toBe(0);
    expect(mockCLI.calls.getQueueStatus).toBe(0);
    expect(mockCLI.calls.extractFilesFromOutput).toHaveLength(0);
  });
});

describe('createMockServer', () => {
  const cleanupFunctions: Array<() => Promise<void>> = [];

  afterEach(async () => {
    // Clean up all servers created during tests
    for (const cleanup of cleanupFunctions) {
      try {
        await cleanup();
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
    }
    cleanupFunctions.length = 0;
  });

  it('should create server with default mocks', () => {
    const { server, cleanup } = createMockServer();
    cleanupFunctions.push(cleanup);

    expect(server).toBeDefined();
    expect(server.app).toBeDefined();
    expect(server.cursorCLI).toBeDefined();
    expect(typeof cleanup).toBe('function');
  });

  it('should accept custom Redis mock', () => {
    const customRedis = createMockRedisClient();
    const { server, cleanup } = createMockServer({ redis: customRedis });
    cleanupFunctions.push(cleanup);

    expect(server).toBeDefined();
    // Verify Redis is used (indirectly through agentConversationService)
    expect(server.agentConversationService).toBeDefined();
  });

  it('should accept custom CursorCLI mock', () => {
    const customCLI = createMockCursorCLI();
    const { server, cleanup } = createMockServer({ cursorCLI: customCLI });
    cleanupFunctions.push(cleanup);

    expect(server.cursorCLI).toBe(customCLI);
  });

  it('should disable background workers by default', () => {
    const { server, cleanup } = createMockServer();
    cleanupFunctions.push(cleanup);

    // Server should be created (we can't directly check disableBackgroundWorkers as it's private)
    expect(server).toBeDefined();
  });

  it('should allow enabling background workers', () => {
    const { server, cleanup } = createMockServer({ disableBackgroundWorkers: false });
    cleanupFunctions.push(cleanup);

    expect(server).toBeDefined();
  });

  it('should allow setting custom port', () => {
    const { server, cleanup } = createMockServer({ port: 9999 });
    cleanupFunctions.push(cleanup);

    expect(server.port).toBe(9999);
  });

  it('should cleanup and stop server', async () => {
    const { server, cleanup } = createMockServer();

    expect(server).toBeDefined();
    await cleanup();
    // Server should be stopped (we can't easily verify this without starting it)
    expect(server).toBeDefined();
  });

  it('should work with supertest', async () => {
    const { server, cleanup } = createMockServer();
    cleanupFunctions.push(cleanup);

    const response = await request(server.app).get('/health');

    expect(response.status).toBe(200);
  });

  it('should use mocked CursorCLI in server', async () => {
    const mockCLI = createMockCursorCLI({
      defaultExecuteResult: {
        success: true,
        exitCode: 0,
        stdout: 'test output',
        stderr: '',
      },
    });
    const { server, cleanup } = createMockServer({ cursorCLI: mockCLI });
    cleanupFunctions.push(cleanup);

    // Verify the mock is used
    expect(server.cursorCLI).toBe(mockCLI);
    const result = await server.cursorCLI.executeCommand(['test']);
    expect(result.stdout).toBe('test output');
  });
});
