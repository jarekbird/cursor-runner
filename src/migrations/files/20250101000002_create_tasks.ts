import Database from 'better-sqlite3';

/**
 * Migration: Create tasks table
 * This table stores tasks/prompts that can be processed by the task operator
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      createdat TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedat TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      uuid TEXT,
      status INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create indexes
  context.exec(`
    CREATE INDEX IF NOT EXISTS index_tasks_on_status 
    ON tasks(status)
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_tasks_on_order 
    ON tasks("order")
  `);

  context.exec(`
    CREATE INDEX IF NOT EXISTS index_tasks_on_status_and_order 
    ON tasks(status, "order")
  `);

  context.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS index_tasks_on_uuid 
    ON tasks(uuid)
  `);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP INDEX IF EXISTS index_tasks_on_uuid');
  context.exec('DROP INDEX IF EXISTS index_tasks_on_status_and_order');
  context.exec('DROP INDEX IF EXISTS index_tasks_on_order');
  context.exec('DROP INDEX IF EXISTS index_tasks_on_status');
  context.exec('DROP TABLE IF EXISTS tasks');
}


