import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { GitService } from '../src/git-service.js';

describe('GitService', () => {
  let gitService;

  beforeEach(() => {
    gitService = new GitService();
  });

  describe('extractRepositoryName', () => {
    it('should extract repository name from various URL formats', () => {
      expect(gitService.extractRepositoryName('https://github.com/user/repo.git')).toBe('repo');
      expect(gitService.extractRepositoryName('https://github.com/user/repo')).toBe('repo');
      expect(gitService.extractRepositoryName('git@github.com:user/repo.git')).toBe('repo');
      expect(gitService.extractRepositoryName('user/repo')).toBe('repo');
      expect(gitService.extractRepositoryName('https://github.com/user/my-awesome-repo.git')).toBe('my-awesome-repo');
    });
  });

  describe('cloneRepository', () => {
    it('should throw error if repository URL is missing', async () => {
      await expect(gitService.cloneRepository(null)).rejects.toThrow('Invalid repository URL');
      await expect(gitService.cloneRepository('')).rejects.toThrow('Invalid repository URL');
    });
  });

  describe('checkoutBranch', () => {
    it('should throw error if repository or branch name is missing', async () => {
      await expect(gitService.checkoutBranch(null, 'main')).rejects.toThrow(
        'Repository name and branch name are required'
      );
      
      await expect(gitService.checkoutBranch('repo', null)).rejects.toThrow(
        'Repository name and branch name are required'
      );
      
      await expect(gitService.checkoutBranch('', 'main')).rejects.toThrow(
        'Repository name and branch name are required'
      );
    });
  });

  describe('pushBranch', () => {
    it('should throw error if repository or branch name is missing', async () => {
      await expect(gitService.pushBranch(null, 'main')).rejects.toThrow(
        'Repository name and branch name are required'
      );
      
      await expect(gitService.pushBranch('repo', null)).rejects.toThrow(
        'Repository name and branch name are required'
      );
    });
  });

  describe('pullBranch', () => {
    it('should throw error if repository or branch name is missing', async () => {
      await expect(gitService.pullBranch(null, 'main')).rejects.toThrow(
        'Repository name and branch name are required'
      );
      
      await expect(gitService.pullBranch('repo', null)).rejects.toThrow(
        'Repository name and branch name are required'
      );
    });
  });
});
