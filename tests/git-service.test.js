// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach } from '@jest/globals';
import { GitService } from '../src/git-service.js';
import os from 'os';
import fs from 'fs';

describe('GitService', () => {
  let gitService;

  beforeEach(() => {
    gitService = new GitService();
  });

  describe('repositoriesPath', () => {
    it('should have a repositories path configured', () => {
      expect(gitService.repositoriesPath).toBeDefined();
      expect(typeof gitService.repositoriesPath).toBe('string');
    });

    it('should use REPOSITORIES_PATH environment variable if set', () => {
      const originalEnv = process.env.REPOSITORIES_PATH;
      const tempPath = `${os.tmpdir()}/test-repositories-${Date.now()}`;
      process.env.REPOSITORIES_PATH = tempPath;

      const customGitService = new GitService();
      expect(customGitService.repositoriesPath).toBe(tempPath);

      // Clean up
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { recursive: true, force: true });
      }

      process.env.REPOSITORIES_PATH = originalEnv;
    });
  });
});
