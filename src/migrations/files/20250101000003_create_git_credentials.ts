import Database from 'better-sqlite3';

/**
 * Migration: Create git_credentials table
 * This table stores Git authentication credentials
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS git_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT,
      password TEXT,
      token TEXT,
      repository_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_git_credentials_on_name 
    ON git_credentials(name)
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_git_credentials_on_active 
    ON git_credentials(active)
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_git_credentials_on_repository_url 
    ON git_credentials(repository_url)
  `);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP INDEX IF EXISTS index_git_credentials_on_repository_url');
  context.exec('DROP INDEX IF EXISTS index_git_credentials_on_active');
  context.exec('DROP INDEX IF EXISTS index_git_credentials_on_name');
  context.exec('DROP TABLE IF EXISTS git_credentials');
}
