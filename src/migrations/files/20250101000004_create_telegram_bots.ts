import Database from 'better-sqlite3';

/**
 * Migration: Create telegram_bots table
 * This table stores Telegram bot configurations
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS telegram_bots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      bot_token TEXT NOT NULL,
      webhook_secret TEXT NOT NULL,
      bot_type TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_telegram_bots_on_name 
    ON telegram_bots(name)
  `);

  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_telegram_bots_on_bot_token 
    ON telegram_bots(bot_token)
  `);

  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_telegram_bots_on_webhook_secret 
    ON telegram_bots(webhook_secret)
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_telegram_bots_on_active 
    ON telegram_bots(active)
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_telegram_bots_on_bot_type 
    ON telegram_bots(bot_type)
  `);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP INDEX IF EXISTS index_telegram_bots_on_bot_type');
  context.exec('DROP INDEX IF EXISTS index_telegram_bots_on_active');
  context.exec('DROP INDEX IF EXISTS index_telegram_bots_on_webhook_secret');
  context.exec('DROP INDEX IF EXISTS index_telegram_bots_on_bot_token');
  context.exec('DROP INDEX IF EXISTS index_telegram_bots_on_name');
  context.exec('DROP TABLE IF EXISTS telegram_bots');
}
