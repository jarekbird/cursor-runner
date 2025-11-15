#!/usr/bin/env tsx

/**
 * Get changed files from git
 * Returns files that have been modified, added, or renamed
 * For CI: compares against base branch
 * For local: compares against HEAD
 */

import { execSync } from 'child_process';

const isCI = process.env.CI === 'true';
const baseRef = process.env.GITHUB_BASE_REF || 'main';
const headRef = process.env.GITHUB_HEAD_REF || process.env.GITHUB_SHA || 'HEAD';

function getChangedFiles(): string[] {
  try {
    const commands: string[] = [];
    
    if (isCI && process.env.GITHUB_EVENT_NAME === 'pull_request') {
      // In PR, compare against base branch
      commands.push(`git diff --name-only --diff-filter=ACMR origin/${baseRef}...HEAD`);
    } else if (isCI) {
      // In push, compare against previous commit
      commands.push(`git diff --name-only --diff-filter=ACMR HEAD~1...HEAD`);
    } else {
      // Local: check both staged and unstaged changes
      commands.push(`git diff --name-only --diff-filter=ACMR HEAD`); // Staged + unstaged
      commands.push(`git diff --cached --name-only --diff-filter=ACMR`); // Staged only
    }
    
    const allFiles = new Set<string>();
    
    for (const command of commands) {
      try {
        const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
        const files = output
          .trim()
          .split('\n')
          .filter(line => line.length > 0)
          .filter(file => file.match(/\.(js|jsx|ts|tsx)$/)); // Only JS/TS files
        
        files.forEach(file => allFiles.add(file));
      } catch (error) {
        // Ignore individual command failures
      }
    }
    
    return Array.from(allFiles);
  } catch (error) {
    // If git command fails, return empty array (will run all tests)
    return [];
  }
}

const changedFiles = getChangedFiles();
console.log(JSON.stringify(changedFiles));

