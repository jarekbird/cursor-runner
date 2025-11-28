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
 * Get Gmail client ID from environment
 * @returns Gmail OAuth client ID or undefined if not set
 */
export function getGmailClientId(): string | undefined {
  return process.env.GMAIL_CLIENT_ID;
}

/**
 * Get Gmail client secret from environment
 * @returns Gmail OAuth client secret or undefined if not set
 */
export function getGmailClientSecret(): string | undefined {
  return process.env.GMAIL_CLIENT_SECRET;
}

/**
 * Get Gmail refresh token from environment
 * @returns Gmail OAuth refresh token or undefined if not set
 */
export function getGmailRefreshToken(): string | undefined {
  return process.env.GMAIL_REFRESH_TOKEN;
}

/**
 * Get Gmail user email from environment
 * @returns Gmail user email or undefined if not set
 */
export function getGmailUserEmail(): string | undefined {
  return process.env.GMAIL_USER_EMAIL;
}

/**
 * Get Gmail allowed labels from environment
 * @returns Comma-separated list of allowed labels or undefined if not set
 */
export function getGmailAllowedLabels(): string | undefined {
  return process.env.GMAIL_ALLOWED_LABELS;
}

/**
 * Check if Gmail MCP is enabled
 * Reads from ENABLE_GMAIL_MCP environment variable
 * Defaults to false (safe default) if not set
 * @returns true if Gmail MCP is enabled, false otherwise
 */
export function getGmailMcpEnabled(): boolean {
  const value = process.env.ENABLE_GMAIL_MCP;
  if (value === undefined || value === '') {
    return false; // Safe default: disabled
  }
  // Accept 'true', '1', 'yes', 'on' as enabled
  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * Validate Gmail configuration
 * Checks if all required Gmail environment variables are set
 * @returns Object with validation result and list of missing variables
 */
export function validateGmailConfig(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!process.env.GMAIL_CLIENT_ID) {
    missing.push('GMAIL_CLIENT_ID');
  }
  if (!process.env.GMAIL_CLIENT_SECRET) {
    missing.push('GMAIL_CLIENT_SECRET');
  }
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    missing.push('GMAIL_REFRESH_TOKEN');
  }

  return {
    valid: missing.length === 0,
    missing,
  };
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
