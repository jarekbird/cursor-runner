/**
 * Integration tests for Tasks API endpoints
 * Tests the full HTTP API for task management using a temporary SQLite database
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createTempSqliteDb, type TempSqliteDb } from './test-utils.js';
import type { Server } from '../src/server.js';

describe('Tasks API Test Infrastructure', () => {
  let tempDb: TempSqliteDb;
  let originalSharedDbPath: string | undefined;
  let server: Server;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Save original SHARED_DB_PATH
    originalSharedDbPath = process.env.SHARED_DB_PATH;

    // Create temp SQLite DB and run migrations
    tempDb = await createTempSqliteDb();

    // Set SHARED_DB_PATH to temp DB path
    // Note: TaskService reads SHARED_DB_PATH at module load time as a constant,
    // so this may not work if the module is already imported. We'll handle this
    // by manually replacing the TaskService instance after creating the server.
    process.env.SHARED_DB_PATH = tempDb.dbPath;

    // Dynamically import createMockServer after setting env var
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const { createMockServer } = await import('./test-utils.js');

    // Create mock server
    const mockServerResult = createMockServer();
    server = mockServerResult.server;
    cleanup = mockServerResult.cleanup;

    // TaskService now reads SHARED_DB_PATH dynamically, so it will use the temp DB path
    // No need to manually replace it

    // Start server
    await server.start();
  });

  afterAll(async () => {
    // Stop server
    if (cleanup) {
      await cleanup();
    }

    // Restore original SHARED_DB_PATH
    if (originalSharedDbPath !== undefined) {
      process.env.SHARED_DB_PATH = originalSharedDbPath;
    } else {
      delete process.env.SHARED_DB_PATH;
    }

    // Clean up temp DB
    if (tempDb) {
      await tempDb.cleanup();
    }
  });

  /**
   * Helper to reset DB state between tests
   * Deletes all tasks from the database
   */
  beforeEach(async () => {
    // Clear all tasks from the database
    const db = tempDb.db;
    db.prepare('DELETE FROM tasks').run();
  });

  it('should verify temp DB is created', () => {
    expect(tempDb).toBeDefined();
    expect(tempDb.db).toBeDefined();
    expect(tempDb.dbPath).toBeDefined();
    expect(tempDb.cleanup).toBeDefined();
    expect(typeof tempDb.cleanup).toBe('function');
  });

  it('should verify migrations run successfully', () => {
    // Check that schema_migrations table exists
    const db = tempDb.db;
    const migrations = db
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all() as Array<{ name: string }>;

    // At minimum, there should be some migrations
    expect(migrations.length).toBeGreaterThan(0);

    // Check that tasks table exists
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .get() as { name: string } | undefined;

    expect(tables).toBeDefined();
    expect(tables?.name).toBe('tasks');
  });

  it('should verify server can connect to temp DB', async () => {
    // Verify server is running and can connect to temp DB
    const response = await request(server.app).get('/api/tasks');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
