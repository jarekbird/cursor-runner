/**
 * Shared test utilities for cleanup and setup
 * Ensures all tests properly clean up resources to prevent hanging
 */
import type { Server } from '../src/server.js';
import { Server as ServerClass } from '../src/server.js';
import type Redis from 'ioredis';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { Umzug } from 'umzug';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ReviewAgentService } from '../src/review-agent-service.js';
import { CursorExecutionService } from '../src/cursor-execution-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestCleanup {
  server?: Server;
  redis?: Redis;
  cleanup: () => Promise<void>;
}

/**
 * Options for creating a mock Redis client
 */
export interface MockRedisOptions {
  /**
   * Simulate connection failure - all operations will reject
   */
  simulateConnectionFailure?: boolean;
  /**
   * Initial connection status
   */
  initialStatus?: 'ready' | 'connecting' | 'end' | 'close';
}

/**
 * In-memory storage for mock Redis
 */
interface MockRedisStorage {
  strings: Map<string, { value: string; expiresAt?: number }>;
  sets: Map<string, Set<string>>;
}

/**
 * Creates a fully functional mock Redis client for testing
 * Supports basic Redis operations: get, set, setex, smembers, sadd, srem, del, exists, expire, keys
 *
 * @param options - Configuration options for the mock client
 * @returns A mock Redis client that implements the ioredis interface
 *
 * @example
 * ```typescript
 * const mockRedis = createMockRedisClient();
 * await mockRedis.set('key', 'value');
 * const value = await mockRedis.get('key'); // 'value'
 * ```
 *
 * @example
 * ```typescript
 * // Simulate connection failure
 * const mockRedis = createMockRedisClient({ simulateConnectionFailure: true });
 * await mockRedis.get('key'); // throws error
 * ```
 */
export function createMockRedisClient(options: MockRedisOptions = {}): Partial<Redis> {
  const storage: MockRedisStorage = {
    strings: new Map(),
    sets: new Map(),
  };

  const { simulateConnectionFailure = false, initialStatus = 'ready' } = options;
  let status: 'ready' | 'connecting' | 'end' | 'close' = initialStatus;

  // Helper to check if key has expired
  const isExpired = (key: string): boolean => {
    const entry = storage.strings.get(key);
    if (!entry || !entry.expiresAt) {
      return false;
    }
    if (Date.now() >= entry.expiresAt) {
      storage.strings.delete(key);
      return true;
    }
    return false;
  };

  // Helper to throw connection error if configured
  const checkConnection = (): void => {
    if (simulateConnectionFailure || status === 'close') {
      throw new Error('Redis connection failed');
    }
  };

  const mockRedis: Partial<Redis> & { status: typeof status } = {
    get status() {
      return status;
    },
    set status(value: typeof status) {
      status = value;
    },

    async get(key: string): Promise<string | null> {
      checkConnection();
      if (isExpired(key)) {
        return null;
      }
      const entry = storage.strings.get(key);
      return entry ? entry.value : null;
    },

    async set(key: string, value: string): Promise<'OK'> {
      checkConnection();
      storage.strings.set(key, { value });
      return 'OK';
    },

    async setex(key: string, seconds: number, value: string): Promise<'OK'> {
      checkConnection();
      const expiresAt = Date.now() + seconds * 1000;
      storage.strings.set(key, { value, expiresAt });
      return 'OK';
    },

    async smembers(key: string): Promise<string[]> {
      checkConnection();
      const set = storage.sets.get(key);
      return set ? Array.from(set) : [];
    },

    sadd: (async (key: string, ...members: (string | number | Buffer)[]): Promise<number> => {
      checkConnection();
      let set = storage.sets.get(key);
      if (!set) {
        set = new Set();
        storage.sets.set(key, set);
      }
      let added = 0;
      for (const member of members) {
        const memberStr = String(member);
        if (!set.has(memberStr)) {
          set.add(memberStr);
          added++;
        }
      }
      return added;
    }) as any,

    srem: (async (key: string, ...members: (string | number | Buffer)[]): Promise<number> => {
      checkConnection();
      const set = storage.sets.get(key);
      if (!set) {
        return 0;
      }
      let removed = 0;
      for (const member of members) {
        const memberStr = String(member);
        if (set.delete(memberStr)) {
          removed++;
        }
      }
      if (set.size === 0) {
        storage.sets.delete(key);
      }
      return removed;
    }) as any,

    del: (async (...keys: string[]): Promise<number> => {
      checkConnection();
      let deleted = 0;
      for (const key of keys) {
        if (storage.strings.delete(key)) {
          deleted++;
        }
        if (storage.sets.delete(key)) {
          deleted++;
        }
      }
      return deleted;
    }) as any,

    exists: (async (...keys: string[]): Promise<number> => {
      checkConnection();
      let count = 0;
      for (const key of keys) {
        if (!isExpired(key) && (storage.strings.has(key) || storage.sets.has(key))) {
          count++;
        }
      }
      return count;
    }) as any,

    async expire(key: string, seconds: number): Promise<number> {
      checkConnection();
      const entry = storage.strings.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + seconds * 1000;
        return 1;
      }
      return 0;
    },

    async keys(pattern: string): Promise<string[]> {
      checkConnection();
      const allKeys: string[] = [];

      // Convert glob pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
      const regex = new RegExp(`^${regexPattern}$`);

      // Check string keys
      for (const key of storage.strings.keys()) {
        if (!isExpired(key) && regex.test(key)) {
          allKeys.push(key);
        }
      }

      // Check set keys
      for (const key of storage.sets.keys()) {
        if (regex.test(key)) {
          allKeys.push(key);
        }
      }

      return allKeys;
    },

    async quit(): Promise<'OK'> {
      status = 'end';
      storage.strings.clear();
      storage.sets.clear();
      return 'OK';
    },

    async disconnect(): Promise<void> {
      status = 'end';
      storage.strings.clear();
      storage.sets.clear();
    },
  };

  return mockRedis;
}

/**
 * Create a cleanup function that properly shuts down all resources
 * This ensures Jest exits cleanly and tests don't hang
 */
export async function createTestCleanup(server?: Server, redis?: Redis): Promise<TestCleanup> {
  const cleanup = async (): Promise<void> => {
    // Stop server if it exists
    if (server && typeof server.stop === 'function') {
      try {
        await server.stop();
      } catch (error) {
        // Ignore errors during cleanup
        console.warn('Error stopping server during cleanup:', error);
      }
    }

    // Close Redis connection if it exists
    if (redis && redis.status === 'ready') {
      try {
        await redis.quit();
      } catch (error) {
        // Ignore errors during cleanup
        console.warn('Error closing Redis during cleanup:', error);
      }
    }
  };

  return {
    server,
    redis,
    cleanup,
  };
}

/**
 * Setup Jest afterAll hook with proper cleanup
 * Use this in test files to ensure resources are cleaned up
 */
export function setupTestCleanup(cleanupFn: () => Promise<void>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jestGlobals = global as any;

  // Store cleanup function
  if (!jestGlobals.__testCleanupFunctions) {
    jestGlobals.__testCleanupFunctions = [];
  }
  jestGlobals.__testCleanupFunctions.push(cleanupFn);
}

/**
 * Execute all registered cleanup functions
 * Call this in afterAll hooks
 */
export async function executeAllCleanups(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jestGlobals = global as any;
  const cleanups = jestGlobals.__testCleanupFunctions || [];

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      console.warn('Error during test cleanup:', error);
    }
  }

  // Clear the array
  jestGlobals.__testCleanupFunctions = [];
}

/**
 * Interface for temporary SQLite database result
 */
export interface TempSqliteDb {
  db: Database.Database;
  dbPath: string;
  cleanup: () => Promise<void>;
}

/**
 * Command result from CursorCLI
 */
export interface CommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Options for creating a mock CursorCLI
 */
export interface MockCursorCLIOptions {
  /**
   * Default return value for executeCommand()
   */
  defaultExecuteResult?: CommandResult;
  /**
   * Default return value for validate()
   */
  defaultValidateResult?: boolean;
  /**
   * Default return value for getQueueStatus()
   */
  defaultQueueStatus?: { available: number; waiting: number; maxConcurrent: number };
  /**
   * Simulate validation failure
   */
  simulateValidationFailure?: boolean;
}

/**
 * Call tracking for mock CursorCLI
 */
export interface CursorCLICallTracker {
  executeCommand: Array<{ args: string[]; options?: { cwd?: string; timeout?: number } }>;
  validate: number;
  getQueueStatus: number;
  extractFilesFromOutput: Array<{ output: string }>;
}

/**
 * Mock CursorCLI instance with call tracking
 */
export interface MockCursorCLI {
  executeCommand: (
    args: string[],
    options?: { cwd?: string; timeout?: number }
  ) => Promise<CommandResult>;
  validate: () => Promise<boolean>;
  getQueueStatus: () => { available: number; waiting: number; maxConcurrent: number };
  extractFilesFromOutput: (output: string) => readonly string[];
  calls: CursorCLICallTracker;
  setExecuteResult: (result: CommandResult) => void;
  setValidateResult: (result: boolean) => void;
  setQueueStatus: (status: { available: number; waiting: number; maxConcurrent: number }) => void;
  reset: () => void;
}

/**
 * Creates a temporary SQLite database, runs all migrations, and returns the database instance with a cleanup function.
 * This helper is used in integration tests that need database access without affecting the main database.
 *
 * @returns Promise resolving to database instance, path, and cleanup function
 *
 * @example
 * ```typescript
 * const { db, cleanup } = await createTempSqliteDb();
 * try {
 *   // Use db for tests
 *   const result = db.prepare('SELECT * FROM system_settings').all();
 * } finally {
 *   await cleanup(); // Always cleanup!
 * }
 * ```
 */
export async function createTempSqliteDb(): Promise<TempSqliteDb> {
  // Create unique temp file path
  const tempDir = tmpdir();
  const dbPath = join(
    tempDir,
    `test-db-${Date.now()}-${Math.random().toString(36).substring(7)}.sqlite`
  );

  // Create database connection
  const db = new Database(dbPath);
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Get migrations path (same logic as migration-runner)
  const MIGRATIONS_PATH = path.join(__dirname, '../src/migrations/files');

  // Create Umzug instance for this specific database
  const migrator = new Umzug<Database.Database>({
    migrations: async () => {
      const files = readdirSync(MIGRATIONS_PATH);
      const hasJsFiles = files.some((f) => f.endsWith('.js') && !f.endsWith('.d.ts'));
      const migrationFiles = files
        .filter((file) => {
          if (file.endsWith('.d.ts') || file.endsWith('.map')) {
            return false;
          }
          if (hasJsFiles) {
            return file.endsWith('.js');
          }
          return file.endsWith('.ts');
        })
        .map((file) => {
          const migrationPath = path.join(MIGRATIONS_PATH, file);
          return {
            name: file,
            path: migrationPath,
            up: async () => {
              // eslint-disable-next-line node/no-unsupported-features/es-syntax
              const migration = await import(migrationPath);
              if (typeof migration.up === 'function') {
                return migration.up({ context: db });
              }
              throw new Error(`Migration ${file} does not export an 'up' function`);
            },
            down: async () => {
              // eslint-disable-next-line node/no-unsupported-features/es-syntax
              const migration = await import(migrationPath);
              if (typeof migration.down === 'function') {
                return migration.down({ context: db });
              }
              throw new Error(`Migration ${file} does not export a 'down' function`);
            },
          };
        });

      return migrationFiles;
    },
    context: db,
    logger: {
      info: () => {
        // Silent in tests
      },
      warn: () => {
        // Silent in tests
      },
      error: (msg: string | Record<string, unknown>) => {
        const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
        console.error(`[Migration] ${message}`);
      },
      debug: () => {
        // Silent in tests
      },
    },
    storage: {
      async executed() {
        try {
          const rows = db
            .prepare('SELECT name FROM schema_migrations ORDER BY name')
            .all() as Array<{ name: string }>;
          return rows.map((row) => row.name);
        } catch {
          return [];
        }
      },
      async logMigration({ name }) {
        db.prepare('INSERT INTO schema_migrations (name, executed_at) VALUES (?, ?)').run(
          name,
          new Date().toISOString()
        );
      },
      async unlogMigration({ name }) {
        db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(name);
      },
    },
  });

  // Ensure schema_migrations table exists
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL
      )
    `);
  } catch (error) {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    throw new Error(
      `Failed to create schema_migrations table: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Run all migrations
  try {
    await migrator.up();
  } catch (error) {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    throw new Error(
      `Failed to run migrations: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    try {
      db.close();
    } catch (error) {
      console.warn('Error closing database during cleanup:', error);
    }

    try {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
    } catch (error) {
      console.warn('Error deleting temp database file during cleanup:', error);
    }
  };

  return {
    db,
    dbPath,
    cleanup,
  };
}

/**
 * Creates a fully mocked CursorCLI instance with all methods stubbed.
 * This helper is used in tests that need to verify CursorCLI interactions without actually spawning cursor-cli processes.
 *
 * @param options - Configuration options for the mock
 * @returns A mock CursorCLI instance with call tracking and configurable behavior
 *
 * @example
 * ```typescript
 * const mockCLI = createMockCursorCLI({
 *   defaultExecuteResult: { success: true, exitCode: 0, stdout: 'output', stderr: '' }
 * });
 * const result = await mockCLI.executeCommand(['--version']);
 * expect(mockCLI.calls.executeCommand).toHaveLength(1);
 * ```
 */
export function createMockCursorCLI(options: MockCursorCLIOptions = {}): MockCursorCLI {
  const {
    defaultExecuteResult = { success: true, exitCode: 0, stdout: '', stderr: '' },
    defaultValidateResult = true,
    defaultQueueStatus = { available: 5, waiting: 0, maxConcurrent: 5 },
    simulateValidationFailure = false,
  } = options;

  // Mutable state for configuration
  let executeResult = defaultExecuteResult;
  let validateResult = defaultValidateResult;
  let queueStatus = defaultQueueStatus;

  // Call tracking
  const calls: CursorCLICallTracker = {
    executeCommand: [],
    validate: 0,
    getQueueStatus: 0,
    extractFilesFromOutput: [],
  };

  const mockCLI: MockCursorCLI = {
    async executeCommand(
      args: string[],
      options?: { cwd?: string; timeout?: number }
    ): Promise<CommandResult> {
      calls.executeCommand.push({ args, options });
      return Promise.resolve(executeResult);
    },

    async validate(): Promise<boolean> {
      calls.validate++;
      if (simulateValidationFailure) {
        throw new Error('cursor-cli not available: validation failed');
      }
      return Promise.resolve(validateResult);
    },

    getQueueStatus(): { available: number; waiting: number; maxConcurrent: number } {
      calls.getQueueStatus++;
      return { ...queueStatus };
    },

    extractFilesFromOutput(output: string): readonly string[] {
      calls.extractFilesFromOutput.push({ output });
      // Simple implementation: extract file paths from output
      // Matches patterns like "file: path/to/file.ts" or "Created: path/to/file.ts"
      const filePattern =
        /(?:file|created|modified|updated):\s*([^\s]+\.(ts|js|tsx|jsx|json|md|txt|py|java|go|rs|cpp|h|hpp|yaml|yml))/gi;
      const matches: string[] = [];
      let match;
      while ((match = filePattern.exec(output)) !== null) {
        matches.push(match[1]);
      }
      return matches;
    },

    calls,

    setExecuteResult(result: CommandResult): void {
      executeResult = result;
    },

    setValidateResult(result: boolean): void {
      validateResult = result;
    },

    setQueueStatus(status: { available: number; waiting: number; maxConcurrent: number }): void {
      queueStatus = status;
    },

    reset(): void {
      executeResult = defaultExecuteResult;
      validateResult = defaultValidateResult;
      queueStatus = defaultQueueStatus;
      calls.executeCommand = [];
      calls.validate = 0;
      calls.getQueueStatus = 0;
      calls.extractFilesFromOutput = [];
    },
  };

  return mockCLI;
}

/**
 * Options for creating a mock Server
 */
export interface MockServerOptions {
  /**
   * Optional Redis client (uses createMockRedisClient() if not provided)
   */
  redis?: Partial<Redis>;
  /**
   * Optional CursorCLI mock (uses createMockCursorCLI() if not provided)
   */
  cursorCLI?: MockCursorCLI;
  /**
   * Disable background workers (default: true for tests)
   */
  disableBackgroundWorkers?: boolean;
  /**
   * Custom port (default: uses process.env.PORT or 3001)
   */
  port?: number;
}

/**
 * Result from createMockServer()
 */
export interface MockServerResult {
  server: Server;
  cleanup: () => Promise<void>;
}

/**
 * Creates a Server instance with injected mocks for dependencies.
 * This allows tests to control all server dependencies (Redis, CursorCLI, etc.) without relying on real implementations.
 *
 * @param options - Configuration options for the mock server
 * @returns Server instance and cleanup function
 *
 * @example
 * ```typescript
 * const { server, cleanup } = createMockServer();
 * try {
 *   const response = await request(server.app).get('/health');
 *   expect(response.status).toBe(200);
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export function createMockServer(options: MockServerOptions = {}): MockServerResult {
  const { redis, cursorCLI, disableBackgroundWorkers = true, port } = options;

  // Use provided mocks or create defaults
  const mockRedis = redis || createMockRedisClient();
  const mockCLI = cursorCLI || createMockCursorCLI();

  // Create server with mocked Redis
  const server = new ServerClass(mockRedis as Redis, { disableBackgroundWorkers });

  // Override CursorCLI with mock
  server.cursorCLI = mockCLI as any;
  // Recreate reviewAgent with mocked CursorCLI
  server.reviewAgent = new ReviewAgentService(mockCLI as any);
  // Recreate cursorExecution with mocked CursorCLI
  server.cursorExecution = new CursorExecutionService(
    server.gitService,
    mockCLI as any,
    server.commandParser,
    server.reviewAgent,
    server.filesystem,
    mockRedis as Redis
  );

  // Set custom port if provided
  if (port !== undefined) {
    server.port = port;
  }

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    try {
      await server.stop();
    } catch (error) {
      console.warn('Error stopping server during cleanup:', error);
    }
  };

  return {
    server,
    cleanup,
  };
}

/**
 * Supertest response type for error assertions
 */
export interface SupertestErrorResponse {
  status: number;
  body: {
    success?: boolean;
    error?: string;
    message?: string;
    timestamp?: string;
    path?: string;
    [key: string]: unknown;
  };
}

/**
 * Options for asserting error responses
 */
export interface AssertErrorResponseOptions {
  /**
   * Expected status code (default: any 4xx or 5xx)
   */
  expectedStatus?: number;
  /**
   * Expected error message (optional, can be partial match)
   */
  expectedMessage?: string | RegExp;
  /**
   * Whether to verify success field is false
   */
  verifySuccess?: boolean;
}

/**
 * Asserts that a response is an error response with the expected structure.
 * Validates status code, error field, and optionally the error message.
 *
 * @param response - Supertest response object
 * @param options - Assertion options
 * @throws If assertion fails
 *
 * @example
 * ```typescript
 * const response = await request(server.app).get('/invalid');
 * assertErrorResponse(response, { expectedStatus: 404, expectedMessage: 'Not found' });
 * ```
 */
export function assertErrorResponse(
  response: SupertestErrorResponse,
  options: AssertErrorResponseOptions = {}
): void {
  const { expectedStatus, expectedMessage, verifySuccess = true } = options;

  // Verify status code
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) {
      throw new Error(
        `Expected status code ${expectedStatus}, but got ${response.status}. Response body: ${JSON.stringify(response.body)}`
      );
    }
  } else {
    // Default: should be 4xx or 5xx
    if (response.status < 400) {
      throw new Error(
        `Expected error status code (4xx or 5xx), but got ${response.status}. Response body: ${JSON.stringify(response.body)}`
      );
    }
  }

  // Verify response body is an object
  if (!response.body || typeof response.body !== 'object') {
    throw new Error(
      `Expected error response body to be an object, but got ${typeof response.body}. Response: ${JSON.stringify(response)}`
    );
  }

  // Verify success field is false (if verifySuccess is true)
  if (verifySuccess && response.body.success !== false) {
    throw new Error(
      `Expected error response to have success: false, but got success: ${response.body.success}. Response body: ${JSON.stringify(response.body)}`
    );
  }

  // Verify error or message field exists
  if (!response.body.error && !response.body.message) {
    throw new Error(
      `Expected error response to have 'error' or 'message' field, but got: ${JSON.stringify(response.body)}`
    );
  }

  // Verify error message if provided
  if (expectedMessage !== undefined) {
    const actualMessage = response.body.error || response.body.message || '';
    if (typeof expectedMessage === 'string') {
      if (!actualMessage.includes(expectedMessage)) {
        throw new Error(
          `Expected error message to contain "${expectedMessage}", but got "${actualMessage}". Response body: ${JSON.stringify(response.body)}`
        );
      }
    } else if (expectedMessage instanceof RegExp) {
      if (!expectedMessage.test(actualMessage)) {
        throw new Error(
          `Expected error message to match ${expectedMessage}, but got "${actualMessage}". Response body: ${JSON.stringify(response.body)}`
        );
      }
    }
  }
}

/**
 * Options for asserting success responses
 */
export interface AssertSuccessResponseOptions {
  /**
   * Expected status code (default: 200)
   */
  expectedStatus?: number;
  /**
   * Expected fields that should exist in the response
   */
  expectedFields?: Record<string, unknown>;
  /**
   * Whether to verify success field is true
   */
  verifySuccess?: boolean;
}

/**
 * Asserts that a response is a success response with the expected structure.
 * Validates status code, response structure, and optionally specific fields.
 *
 * @param response - Supertest response object
 * @param options - Assertion options
 * @throws If assertion fails
 *
 * @example
 * ```typescript
 * const response = await request(server.app).get('/health');
 * assertSuccessResponse(response, { expectedStatus: 200 });
 * ```
 *
 * @example
 * ```typescript
 * const response = await request(server.app).post('/api/new');
 * assertSuccessResponse(response, {
 *   expectedStatus: 201,
 *   expectedFields: { conversationId: expect.any(String) }
 * });
 * ```
 */
export function assertSuccessResponse(
  response: SupertestErrorResponse,
  options: AssertSuccessResponseOptions = {}
): void {
  const { expectedStatus = 200, expectedFields, verifySuccess = false } = options;

  // Verify status code
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status code ${expectedStatus}, but got ${response.status}. Response body: ${JSON.stringify(response.body)}`
    );
  }

  // Verify response body is an object
  if (!response.body || typeof response.body !== 'object') {
    throw new Error(
      `Expected success response body to be an object, but got ${typeof response.body}. Response: ${JSON.stringify(response)}`
    );
  }

  // Verify success field is true (if verifySuccess is true)
  if (verifySuccess && response.body.success !== true) {
    throw new Error(
      `Expected success response to have success: true, but got success: ${response.body.success}. Response body: ${JSON.stringify(response.body)}`
    );
  }

  // Verify expected fields if provided
  if (expectedFields) {
    for (const [key, expectedValue] of Object.entries(expectedFields)) {
      if (!(key in response.body)) {
        throw new Error(
          `Expected field "${key}" in response body, but it was missing. Response body: ${JSON.stringify(response.body)}`
        );
      }

      const actualValue = response.body[key];

      // If expectedValue is a Jest matcher (like expect.any()), we can't validate it here
      // The test should use expect() directly for complex matchers
      // For simple values, do a deep equality check
      if (
        expectedValue !== null &&
        typeof expectedValue === 'object' &&
        !Array.isArray(expectedValue) &&
        !(expectedValue instanceof RegExp)
      ) {
        // Skip validation for complex objects - let Jest handle it
        continue;
      }

      // For primitive values, do equality check
      if (
        actualValue !== expectedValue &&
        !(expectedValue instanceof RegExp && expectedValue.test(String(actualValue)))
      ) {
        throw new Error(
          `Expected field "${key}" to be ${JSON.stringify(expectedValue)}, but got ${JSON.stringify(actualValue)}. Response body: ${JSON.stringify(response.body)}`
        );
      }
    }
  }
}
