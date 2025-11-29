#!/usr/bin/env node

/**
 * Create a new migration file
 * Usage: npm run migrate:create <migration_name>
 * Example: npm run migrate:create add_user_table
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, '../src/migrations/files');

// Get migration name from command line
const migrationName = process.argv[2];

if (!migrationName) {
  console.error('Error: Migration name is required');
  console.log('Usage: npm run migrate:create <migration_name>');
  console.log('Example: npm run migrate:create add_user_table');
  process.exit(1);
}

// Generate timestamp (YYYYMMDDHHMMSS format, similar to Rails)
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hour = String(now.getHours()).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');
const second = String(now.getSeconds()).padStart(2, '0');
const timestamp = `${year}${month}${day}${hour}${minute}${second}`;
const fileName = `${timestamp}_${migrationName}.ts`;
const filePath = path.join(migrationsDir, fileName);

// Template for migration file
const template = `import Database from 'better-sqlite3';

/**
 * Migration: ${migrationName}
 * 
 * Generated: ${new Date().toISOString()}
 */
export async function up({ context }: { context: Database.Database }): Promise<void> {
  // TODO: Implement migration
  // Example:
  // context.exec(\`
  //   CREATE TABLE IF NOT EXISTS example (
  //     id INTEGER PRIMARY KEY AUTOINCREMENT,
  //     name TEXT NOT NULL,
  //     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  //   )
  // \`);
}

export async function down({ context }: { context: Database.Database }): Promise<void> {
  // TODO: Implement rollback
  // Example:
  // context.exec('DROP TABLE IF EXISTS example');
}
`;

// Ensure migrations directory exists
if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true });
}

// Check if file already exists
if (fs.existsSync(filePath)) {
  console.error(`Error: Migration file already exists: ${fileName}`);
  process.exit(1);
}

// Write migration file
fs.writeFileSync(filePath, template, 'utf8');

console.log(`✓ Created migration: ${fileName}`);
console.log(`  Path: ${filePath}`);
console.log(`\nNext steps:`);
console.log(`  1. Edit the migration file to implement up() and down()`);
console.log(`  2. Run migrations: npm run migrate`);

