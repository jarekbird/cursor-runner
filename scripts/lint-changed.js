#!/usr/bin/env node

/**
 * Lint only changed files
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get changed files
const changedFilesOutput = execSync('node scripts/get-changed-files.js', { encoding: 'utf-8' });
const changedFiles = JSON.parse(changedFilesOutput);

// Filter to only src/ and tests/ files
const filesToLint = changedFiles.filter(file => 
  file.startsWith('src/') || file.startsWith('tests/')
);

if (filesToLint.length === 0) {
  console.log('No changed files to lint');
  process.exit(0);
}

console.log(`Linting ${filesToLint.length} changed file(s):`);
filesToLint.forEach(file => console.log(`  - ${file}`));

// Run eslint on changed files
try {
  execSync(`npx eslint ${filesToLint.join(' ')}`, { stdio: 'inherit' });
  console.log('✓ Linting passed');
} catch (error) {
  console.error('✗ Linting failed');
  process.exit(1);
}

