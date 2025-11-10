import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Server } from '../src/server.js';

describe('Server', () => {
  let server;
  let app;
  let mockGitService;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create server instance
    server = new Server();
    app = server.app;
    
    // Create mock git service
    mockGitService = {
      cloneRepository: jest.fn(),
      listRepositories: jest.fn(),
      checkoutBranch: jest.fn(),
      pushBranch: jest.fn(),
      pullBranch: jest.fn(),
    };
    
    // Replace gitService with our mock
    server.gitService = mockGitService;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Health Check', () => {
    it('GET /health should return server status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'cursor-runner',
      });
    });
  });

  describe('Git Endpoints', () => {
    describe('POST /git/clone', () => {
      it('should clone a repository successfully', async () => {
        const mockResult = {
          success: true,
          repository: 'test-repo',
          path: '/path/to/repo',
          message: 'Repository cloned successfully',
        };

        mockGitService.cloneRepository.mockResolvedValue(mockResult);

        const response = await request(app)
          .post('/git/clone')
          .send({
            repositoryUrl: 'https://github.com/user/repo.git',
            repositoryName: 'test-repo',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockResult);
        expect(mockGitService.cloneRepository).toHaveBeenCalledWith(
          'https://github.com/user/repo.git',
          'test-repo'
        );
      });

      it('should return 400 if repositoryUrl is missing', async () => {
        const response = await request(app)
          .post('/git/clone')
          .send({
            repositoryName: 'test-repo',
          });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('repositoryUrl is required');
      });

      it('should handle clone errors', async () => {
        mockGitService.cloneRepository.mockRejectedValue(new Error('Repository already exists'));

        const response = await request(app)
          .post('/git/clone')
          .send({
            repositoryUrl: 'https://github.com/user/repo.git',
          });

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Repository already exists');
      });
    });

    describe('GET /git/repositories', () => {
      it('should list repositories successfully', async () => {
        const mockRepositories = [
          {
            name: 'repo1',
            path: '/path/to/repo1',
            remote: 'https://github.com/user/repo1.git',
            currentBranch: 'main',
          },
          {
            name: 'repo2',
            path: '/path/to/repo2',
            remote: 'https://github.com/user/repo2.git',
            currentBranch: 'develop',
          },
        ];

        mockGitService.listRepositories.mockResolvedValue(mockRepositories);

        const response = await request(app).get('/git/repositories');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repositories).toEqual(mockRepositories);
        expect(response.body.count).toBe(2);
      });

      it('should handle list errors', async () => {
        mockGitService.listRepositories.mockRejectedValue(new Error('Failed to list repositories'));

        const response = await request(app).get('/git/repositories');

        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
      });
    });

    describe('POST /git/checkout', () => {
      it('should checkout branch successfully', async () => {
        const mockResult = {
          success: true,
          repository: 'test-repo',
          branch: 'feature-branch',
          message: 'Checked out to branch: feature-branch',
        };

        mockGitService.checkoutBranch.mockResolvedValue(mockResult);

        const response = await request(app)
          .post('/git/checkout')
          .send({
            repository: 'test-repo',
            branch: 'feature-branch',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockResult);
        expect(mockGitService.checkoutBranch).toHaveBeenCalledWith(
          'test-repo',
          'feature-branch'
        );
      });

      it('should return 400 if repository or branch is missing', async () => {
        const response1 = await request(app)
          .post('/git/checkout')
          .send({
            branch: 'feature-branch',
          });

        expect(response1.status).toBe(400);
        expect(response1.body.error).toBe('repository and branch are required');

        const response2 = await request(app)
          .post('/git/checkout')
          .send({
            repository: 'test-repo',
          });

        expect(response2.status).toBe(400);
        expect(response2.body.error).toBe('repository and branch are required');
      });

      it('should handle checkout errors', async () => {
        mockGitService.checkoutBranch.mockRejectedValue(new Error('Repository not found'));

        const response = await request(app)
          .post('/git/checkout')
          .send({
            repository: 'nonexistent',
            branch: 'main',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
      });
    });

    describe('POST /git/push', () => {
      it('should push branch successfully', async () => {
        const mockResult = {
          success: true,
          repository: 'test-repo',
          branch: 'main',
          message: 'Pushed branch main to origin',
          output: 'Pushed successfully',
        };

        mockGitService.pushBranch.mockResolvedValue(mockResult);

        const response = await request(app)
          .post('/git/push')
          .send({
            repository: 'test-repo',
            branch: 'main',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockResult);
        expect(mockGitService.pushBranch).toHaveBeenCalledWith('test-repo', 'main');
      });

      it('should return 400 if repository or branch is missing', async () => {
        const response = await request(app)
          .post('/git/push')
          .send({
            repository: 'test-repo',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('repository and branch are required');
      });

      it('should handle push errors', async () => {
        mockGitService.pushBranch.mockRejectedValue(new Error('Push failed'));

        const response = await request(app)
          .post('/git/push')
          .send({
            repository: 'test-repo',
            branch: 'main',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
      });
    });

    describe('POST /git/pull', () => {
      it('should pull branch successfully', async () => {
        const mockResult = {
          success: true,
          repository: 'test-repo',
          branch: 'main',
          message: 'Pulled branch main from origin',
          output: 'Pulled successfully',
        };

        mockGitService.pullBranch.mockResolvedValue(mockResult);

        const response = await request(app)
          .post('/git/pull')
          .send({
            repository: 'test-repo',
            branch: 'main',
          });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockResult);
        expect(mockGitService.pullBranch).toHaveBeenCalledWith('test-repo', 'main');
      });

      it('should return 400 if repository or branch is missing', async () => {
        const response = await request(app)
          .post('/git/pull')
          .send({
            repository: 'test-repo',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('repository and branch are required');
      });

      it('should handle pull errors', async () => {
        mockGitService.pullBranch.mockRejectedValue(new Error('Pull failed'));

        const response = await request(app)
          .post('/git/pull')
          .send({
            repository: 'test-repo',
            branch: 'main',
          });

        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
      });
    });
  });
});
