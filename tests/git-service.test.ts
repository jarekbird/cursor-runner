// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach } from '@jest/globals';
import { GitService } from '../src/git-service.js';
import os from 'os';
import fs from 'fs';

describe('GitService', () => {
  let gitService: GitService;

  beforeEach(() => {
    gitService = new GitService();
  });

  describe('repositoriesPath', () => {
    it('should have a repositories path configured', () => {
      expect(gitService.repositoriesPath).toBeDefined();
      expect(typeof gitService.repositoriesPath).toBe('string');
    });

    it('should resolve REPOSITORIES_PATH relative to TARGET_APP_PATH when TARGET_APP_PATH is set', () => {
      const originalTargetAppPath = process.env.TARGET_APP_PATH;
      const originalRepositoriesPath = process.env.REPOSITORIES_PATH;

      const tempTargetAppPath = `${os.tmpdir()}/test-target-app-${Date.now()}`;
      process.env.TARGET_APP_PATH = tempTargetAppPath;
      delete process.env.REPOSITORIES_PATH; // Clear explicit REPOSITORIES_PATH to test relative resolution

      const customGitService = new GitService();
      const expectedPath = `${tempTargetAppPath}/repositories`;
      expect(customGitService.repositoriesPath).toBe(expectedPath);

      // Clean up
      if (fs.existsSync(tempTargetAppPath)) {
        fs.rmSync(tempTargetAppPath, { recursive: true, force: true });
      }

      if (originalTargetAppPath) {
        process.env.TARGET_APP_PATH = originalTargetAppPath;
      } else {
        delete process.env.TARGET_APP_PATH;
      }
      if (originalRepositoriesPath) {
        process.env.REPOSITORIES_PATH = originalRepositoriesPath;
      }
    });

    it('should use REPOSITORIES_PATH environment variable if explicitly set (overrides relative path)', () => {
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
