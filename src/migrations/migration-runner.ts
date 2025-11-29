import { Umzug } from 'umzug';
import Database from 'better-sqlite3';
import { logger } from '../logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the shared SQLite database
 */
const SHARED_DB_PATH = process.env.SHARED_DB_PATH || '/app/shared_db/shared.sqlite3';

/**
 * Path to migrations directory
 * In production (compiled), migrations are in dist/migrations/files
 * In development, they're in src/migrations/files
 */
const MIGRATIONS_PATH =
  process.env.NODE_ENV === 'production'
    ? path.join(__dirname, 'files')
    : path.join(__dirname, 'files');

// Migration files are loaded dynamically based on file system

/**
 * Get database connection for migrations (read-write)
 */
function getDatabase(): Database.Database {
  const db = new Database(SHARED_DB_PATH);
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Create Umzug instance for managing migrations
 */
export function createMigrator(): Umzug<Database.Database> {
  const db = getDatabase();

  return new Umzug<Database.Database>({
    migrations: async () => {
      // Manually find migration files, filtering out .d.ts files
      const files = readdirSync(MIGRATIONS_PATH);
      // Check if we're in compiled mode (dist directory has .js files) or source mode (src has .ts files)
      const hasJsFiles = files.some((f) => f.endsWith('.js') && !f.endsWith('.d.ts'));
      const migrationFiles = files
        .filter((file) => {
          // Always exclude .d.ts, .map files, and other non-migration files
          if (file.endsWith('.d.ts') || file.endsWith('.map')) {
            return false;
          }
          // If we have .js files (compiled), only use .js files
          if (hasJsFiles) {
            return file.endsWith('.js');
          }
          // Otherwise, use .ts files (source mode)
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
      info: (msg: string | Record<string, unknown>) => {
        const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
        logger.info(`[Migration] ${message}`);
      },
      warn: (msg: string | Record<string, unknown>) => {
        const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
        logger.warn(`[Migration] ${message}`);
      },
      error: (msg: string | Record<string, unknown>) => {
        const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
        logger.error(`[Migration] ${message}`);
      },
      debug: (msg: string | Record<string, unknown>) => {
        const message = typeof msg === 'string' ? msg : JSON.stringify(msg);
        logger.debug(`[Migration] ${message}`);
      },
    },
    storage: {
      async executed() {
        // Get list of executed migrations from schema_migrations table
        try {
          const rows = db
            .prepare('SELECT name FROM schema_migrations ORDER BY name')
            .all() as Array<{ name: string }>;
          return rows.map((row) => row.name);
        } catch {
          // Table doesn't exist yet - return empty array
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
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  const migrator = createMigrator();

  try {
    const pending = await migrator.pending();
    if (pending.length === 0) {
      logger.info('No pending migrations');
      return;
    }

    logger.info(`Found ${pending.length} pending migration(s)`);
    await migrator.up();
    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Rollback the last migration
 */
export async function rollbackMigration(): Promise<void> {
  logger.info('Rolling back last migration...');
  const migrator = createMigrator();

  try {
    await migrator.down();
    logger.info('Migration rolled back successfully');
  } catch (error) {
    logger.error('Rollback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  executed: string[];
  pending: string[];
}> {
  const migrator = createMigrator();
  const executed = await migrator.executed();
  const pending = await migrator.pending();

  return {
    executed: executed.map((m) => m.name),
    pending: pending.map((m) => m.name),
  };
}

/**
 * Ensure schema_migrations table exists
 */
export function ensureSchemaMigrationsTable(): void {
  const db = getDatabase();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL
      )
    `);
    logger.debug('schema_migrations table ensured');
  } catch (error) {
    logger.error('Failed to create schema_migrations table', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    db.close();
  }
}
