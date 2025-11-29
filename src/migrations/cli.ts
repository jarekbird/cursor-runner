#!/usr/bin/env node

/**
 * Migration CLI tool
 * Usage:
 *   npm run migrate          - Run all pending migrations
 *   npm run migrate:rollback - Rollback last migration
 *   npm run migrate:status  - Show migration status
 */

import { runMigrations, rollbackMigration, getMigrationStatus, ensureSchemaMigrationsTable } from './migration-runner.js';
import { logger } from '../logger.js';

const command = process.argv[2];

async function main() {
  try {
    // Ensure schema_migrations table exists
    ensureSchemaMigrationsTable();

    switch (command) {
      case 'up':
      case 'migrate':
        await runMigrations();
        break;

      case 'down':
      case 'rollback':
        await rollbackMigration();
        break;

      case 'status':
        const status = await getMigrationStatus();
        console.log('\n=== Migration Status ===');
        console.log(`Executed: ${status.executed.length} migration(s)`);
        if (status.executed.length > 0) {
          status.executed.forEach((name) => console.log(`  ✓ ${name}`));
        }
        console.log(`Pending: ${status.pending.length} migration(s)`);
        if (status.pending.length > 0) {
          status.pending.forEach((name) => console.log(`  ○ ${name}`));
        } else {
          console.log('  (no pending migrations)');
        }
        console.log('');
        break;

      default:
        console.log('Usage:');
        console.log('  npm run migrate          - Run all pending migrations');
        console.log('  npm run migrate:rollback - Rollback last migration');
        console.log('  npm run migrate:status  - Show migration status');
        process.exit(1);
    }
  } catch (error) {
    logger.error('Migration command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();


