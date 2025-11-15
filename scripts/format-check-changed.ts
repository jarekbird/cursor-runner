#!/usr/bin/env tsx

/**
 * Check formatting of only changed files
 */

import { execSync } from 'child_process';

// Get changed files
const changedFilesOutput = execSync('tsx scripts/get-changed-files.ts', { encoding: 'utf-8' });
const changedFiles: string[] = JSON.parse(changedFilesOutput);

// Filter to only src/ and tests/ files
const filesToCheck = changedFiles.filter(file => 
  file.startsWith('src/') || file.startsWith('tests/')
);

if (filesToCheck.length === 0) {
  console.log('No changed files to check formatting');
  process.exit(0);
}

console.log(`Checking formatting for ${filesToCheck.length} changed file(s):`);
filesToCheck.forEach(file => console.log(`  - ${file}`));

// Run prettier check on changed files
try {
  execSync(`npx prettier --check ${filesToCheck.join(' ')}`, { stdio: 'inherit' });
  console.log('✓ Formatting check passed');
} catch (error) {
  console.error('✗ Formatting check failed');
  console.error('Tip: Run "npm run format" to auto-format code');
  process.exit(1);
}

