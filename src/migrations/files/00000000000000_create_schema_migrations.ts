import Database from 'better-sqlite3';

/**
 * Initial migration: Create schema_migrations table
 * This table tracks which migrations have been executed
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      executed_at TEXT NOT NULL
    )
  `);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP TABLE IF EXISTS schema_migrations');
}
