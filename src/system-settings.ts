import Database from 'better-sqlite3';
import { logger } from './logger.js';

/**
 * Path to the shared SQLite database
 * This database is shared across multiple services in the cursor-runner ecosystem
 */
const SHARED_DB_PATH = process.env.SHARED_DB_PATH || '/app/shared_db/shared.sqlite3';

/**
 * Cache for database connection (lazy initialization)
 */
let db: Database.Database | null = null;

/**
 * Get database connection (lazy initialization)
 */
function getDatabase(): Database.Database | null {
  if (!db) {
    try {
      db = new Database(SHARED_DB_PATH, { readonly: true });
      // Enable WAL mode for better concurrency (allows multiple readers)
      db.pragma('journal_mode = WAL');
      logger.debug('Database connection established for system settings', { path: SHARED_DB_PATH });
    } catch (error) {
      logger.warn('Failed to connect to database for system settings', {
        path: SHARED_DB_PATH,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return null on error - we'll fall back to environment variable
      return null;
    }
  }
  return db;
}

/**
 * Check if a system setting is enabled
 * This method reads fresh data from the database each time it's called
 * (no caching), ensuring we get the latest value even if it was changed
 * by another process.
 *
 * Falls back to environment variable if database is not available.
 *
 * @param settingName - Name of the system setting to check
 * @returns true if the setting is enabled, false otherwise
 */
export function isSystemSettingEnabled(settingName: string): boolean {
  // First, try to read from database
  const database = getDatabase();
  if (database) {
    try {
      // Execute a fresh query each time to get the latest value
      // SQLite with WAL mode ensures we see committed writes from other processes
      const row = database
        .prepare('SELECT value FROM system_settings WHERE name = ?')
        .get(settingName) as { value: number } | undefined;

      // SQLite stores booleans as 0/1 integers
      if (row !== undefined) {
        return row.value === 1;
      }
    } catch (error) {
      logger.warn('Failed to read system setting from database', {
        settingName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to environment variable check
    }
  }

  // Fallback to environment variable for 'debug' setting
  if (settingName === 'debug') {
    return process.env.DEBUG === 'true' || process.env.DEBUG === '1';
  }

  // Default to false if setting not found
  return false;
}

/**
 * Close database connection (for cleanup/testing)
 */
export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
      db = null;
      logger.debug('Database connection closed');
    } catch (error) {
      logger.warn('Error closing database connection', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
