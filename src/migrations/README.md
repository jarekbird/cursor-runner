# Database Migrations

This directory contains database migrations for the shared SQLite database, similar to Rails migrations.

## Overview

Migrations are managed using [umzug](https://github.com/sequelize/umzug), a migration framework that works with `better-sqlite3`. Migrations track database schema changes over time and can be run forward (up) or rolled back (down).

## Migration Files

Migrations are stored in `src/migrations/files/` and follow this naming pattern:
- `{timestamp}_{migration_name}.ts`
- Example: `20250116120000_create_users_table.ts`

Each migration file exports two functions:
- `up({ context })` - Applies the migration
- `down({ context })` - Rolls back the migration

## Commands

### Create a new migration
```bash
npm run migrate:create <migration_name>
```

Example:
```bash
npm run migrate:create add_user_table
```

This creates a new migration file with a timestamp and the provided name.

### Run pending migrations
```bash
npm run migrate
```

Runs all migrations that haven't been executed yet, in order.

### Rollback last migration
```bash
npm run migrate:rollback
```

Rolls back the most recently executed migration.

### Check migration status
```bash
npm run migrate:status
```

Shows which migrations have been executed and which are pending.

## Migration Example

```typescript
import Database from 'better-sqlite3';

export async function up({ context }: { context: Database.Database }): Promise<void> {
  context.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create index
  context.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  context.exec('DROP TABLE IF EXISTS users');
}
```

## Database Connection

Migrations use the shared SQLite database at:
- **Path**: `/app/shared_db/shared.sqlite3` (in Docker)
- **Environment Variable**: `SHARED_DB_PATH` (can override)

The database connection is automatically configured with WAL mode for better concurrency.

## Migration Tracking

Executed migrations are tracked in the `schema_migrations` table:
- `name` - Migration filename (primary key)
- `executed_at` - ISO timestamp when migration was executed

## Integration with Application Startup

**Migrations are automatically run on application startup!** 

The migration system is integrated into `src/index.ts` and runs automatically when the application initializes. This ensures the database schema is always up-to-date when the application starts.

The migration process:
1. Ensures the `schema_migrations` table exists
2. Runs all pending migrations in order
3. Logs the results
4. Continues with application startup even if migrations fail (allows read-only mode)

If migrations fail, the application will log a warning but continue starting. This allows the application to start in read-only mode if the database is temporarily unavailable or locked.

## Best Practices

1. **Always write both `up` and `down` functions** - This allows rollbacks if needed
2. **Use transactions when possible** - Wrap multiple operations in a transaction
3. **Test migrations** - Test both up and down migrations before deploying
4. **Keep migrations small** - One logical change per migration
5. **Never modify existing migrations** - Create a new migration to fix issues
6. **Use descriptive names** - Migration names should clearly describe what they do

## Troubleshooting

### Migration fails to run
- Check that the database file exists and is writable
- Verify the migration file syntax is correct
- Check logs for specific error messages

### Migration already executed
- If a migration shows as executed but shouldn't be, check the `schema_migrations` table
- You can manually remove entries if needed (be careful!)

### Path issues in production
- In production (compiled), migrations are in `dist/migrations/files/`
- Ensure migrations are included in the build output

