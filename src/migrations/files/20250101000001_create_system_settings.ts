import Database from 'better-sqlite3';

/**
 * Migration: Create system_settings table
 * This table stores system-wide boolean settings
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      name TEXT NOT NULL PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create unique index on name
  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_system_settings_on_name 
    ON system_settings(name)
  `);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP INDEX IF EXISTS index_system_settings_on_name');
  context.exec('DROP TABLE IF EXISTS system_settings');
}
