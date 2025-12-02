// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('Baseline Verification (TASK-PY-001.01)', () => {
  const baselineFilePath = path.join(
    process.cwd(),
    'plan',
    'python-converstion',
    'baseline.md'
  );

  describe('Baseline file exists', () => {
    it('should have baseline.md file in plan/python-converstion directory', () => {
      expect(fs.existsSync(baselineFilePath)).toBe(true);
    });
  });

  describe('Baseline file content', () => {
    let baselineContent: string;

    beforeAll(() => {
      baselineContent = fs.readFileSync(baselineFilePath, 'utf-8');
    });

    it('should contain commit SHA', () => {
      expect(baselineContent).toMatch(/Commit SHA/i);
    });

    it('should contain branch name', () => {
      expect(baselineContent).toMatch(/Branch/i);
    });

    it('should contain baseline date', () => {
      expect(baselineContent).toMatch(/Baseline Date/i);
    });

    it('should contain repository information', () => {
      expect(baselineContent).toMatch(/Repository/i);
      expect(baselineContent).toMatch(/Repository URL/i);
    });
  });

  describe('Commit SHA validation', () => {
    let commitSha: string;

    beforeAll(() => {
      const baselineContent = fs.readFileSync(baselineFilePath, 'utf-8');
      // Match markdown format: - **Commit SHA**: `sha` (with optional markdown formatting)
      const shaMatch = baselineContent.match(/\*\*Commit SHA\*\*:\s*`([a-f0-9]{40})`/i) ||
                       baselineContent.match(/Commit SHA:\s*`([a-f0-9]{40})`/i) ||
                       baselineContent.match(/Commit SHA[:\s]+([a-f0-9]{40})/i);
      expect(shaMatch).not.toBeNull();
      commitSha = shaMatch![1];
    });

    it('should have valid 40-character hexadecimal commit SHA', () => {
      expect(commitSha).toMatch(/^[a-f0-9]{40}$/i);
      expect(commitSha.length).toBe(40);
    });

    it('should be able to checkout the commit SHA', () => {
      // This test verifies the commit exists in the repository
      // We use git cat-file to check if the commit exists without actually checking it out
      try {
        const result = execSync(`git cat-file -t ${commitSha}`, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect(result.trim()).toBe('commit');
      } catch (error) {
        // If git cat-file fails, the commit doesn't exist
        throw new Error(`Commit SHA ${commitSha} does not exist in repository`);
      }
    });

    it('should match current HEAD or be a valid commit in history', () => {
      // Verify the commit is in the repository history
      try {
        execSync(`git rev-parse --verify ${commitSha}^{commit}`, {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        // If this succeeds, the commit is valid
        expect(true).toBe(true);
      } catch (error) {
        throw new Error(`Commit SHA ${commitSha} is not a valid commit in repository`);
      }
    });
  });

  describe('Repository state information', () => {
    let baselineContent: string;

    beforeAll(() => {
      baselineContent = fs.readFileSync(baselineFilePath, 'utf-8');
    });

    it('should document repository state', () => {
      expect(baselineContent).toMatch(/Repository State/i);
    });

    it('should contain verification section', () => {
      expect(baselineContent).toMatch(/Verification/i);
    });

    it('should contain usage instructions', () => {
      expect(baselineContent).toMatch(/Usage/i);
      expect(baselineContent).toMatch(/git checkout/i);
    });
  });
});
