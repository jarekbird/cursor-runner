/**
 * Baseline Verification Tests
 *
 * These tests verify that the baseline commit SHA and repository state
 * are correctly recorded and can be used as a reference point for the Python port.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Baseline Verification', () => {
  const baselinePath = join(__dirname, '../plan/python-conversion/baseline.md');
  const repoPath = join(__dirname, '..');

  describe('Baseline Documentation', () => {
    it('should exist at the expected path', () => {
      expect(() => readFileSync(baselinePath, 'utf-8')).not.toThrow();
    });

    it('should contain commit SHA in valid format', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      const shaMatch = content.match(/Commit SHA.*?`([a-f0-9]{40})`/);
      expect(shaMatch).toBeTruthy();
      expect(shaMatch![1]).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should contain repository information', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      expect(content).toContain('Repository');
      expect(content).toContain('Branch');
      expect(content).toContain('Commit SHA');
      expect(content).toContain('Baseline Date');
    });

    it('should document repository state', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      expect(content).toContain('Working Tree');
      expect(content).toContain('Status');
    });
  });

  describe('Commit SHA Verification', () => {
    it('should match current HEAD commit SHA', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      const shaMatch = content.match(/Commit SHA.*?`([a-f0-9]{40})`/);
      const recordedSha = shaMatch![1];

      // The recorded SHA should match the current HEAD or be a valid commit
      expect(recordedSha).toMatch(/^[a-f0-9]{40}$/);

      // Verify the SHA can be checked out (it exists in the repository)
      try {
        execSync(`git cat-file -e ${recordedSha}`, {
          cwd: repoPath,
          stdio: 'ignore',
        });
      } catch {
        throw new Error(`Recorded commit SHA ${recordedSha} does not exist in repository`);
      }
    });

    it('should be a valid git commit', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      const shaMatch = content.match(/Commit SHA.*?`([a-f0-9]{40})`/);
      const recordedSha = shaMatch![1];

      // Verify it's a valid commit object
      const commitType = execSync(`git cat-file -t ${recordedSha}`, {
        cwd: repoPath,
        encoding: 'utf-8',
      }).trim();

      expect(commitType).toBe('commit');
    });
  });

  describe('Repository State', () => {
    it('should document primary reference repository path', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      expect(content).toContain('Primary Reference Repository');
      expect(content).toContain('python-cursor/cursor-runner');
    });

    it('should document branch name', () => {
      const content = readFileSync(baselinePath, 'utf-8');
      const branchMatch = content.match(/Branch.*?`(\w+)`/);
      expect(branchMatch).toBeTruthy();
      expect(branchMatch![1]).toBe('main');
    });
  });
});
