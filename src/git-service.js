import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * GitService - Handles git operations
 *
 * Provides secure git command execution with validation and error handling.
 */
export class GitService {
  constructor() {
    this.repositoriesPath =
      process.env.REPOSITORIES_PATH || path.join(process.cwd(), 'repositories');
    this.timeout = parseInt(process.env.GIT_COMMAND_TIMEOUT || '60000', 10); // 1 minute default

    // Ensure repositories directory exists
    this.ensureRepositoriesDirectory();
  }

  /**
   * Ensure repositories directory exists
   */
  ensureRepositoriesDirectory() {
    if (!existsSync(this.repositoriesPath)) {
      mkdirSync(this.repositoriesPath, { recursive: true });
      logger.info('Created repositories directory', { path: this.repositoriesPath });
    }
  }

  /**
   * Execute git command safely
   * @param {Array<string>} args - Git command arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Command result
   */
  async executeGitCommand(args, options = {}) {
    return new Promise((resolve, reject) => {
      const cwd = options.cwd || this.repositoriesPath;
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing git command', { args, cwd });

      const child = spawn('git', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      // Set timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Git command timeout after ${timeout}ms`));
      }, timeout);

      // Collect stdout
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);

        const result = {
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        if (code === 0) {
          logger.debug('Git command completed successfully', { args });
          resolve(result);
        } else {
          logger.warn('Git command failed', { args, exitCode: code, stderr });
          reject(new Error(`Git command failed: ${stderr || stdout}`));
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.error('Git command error', { args, error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Clone a repository
   * @param {string} repositoryUrl - Repository URL to clone
   * @param {string} repositoryName - Optional repository name (defaults to URL basename)
   * @returns {Promise<Object>} Clone result
   */
  async cloneRepository(repositoryUrl, repositoryName = null) {
    try {
      // Validate URL
      if (!repositoryUrl || typeof repositoryUrl !== 'string') {
        throw new Error('Invalid repository URL');
      }

      // Determine repository name
      const repoName = repositoryName || this.extractRepositoryName(repositoryUrl);
      const targetPath = path.join(this.repositoriesPath, repoName);

      // Check if repository already exists
      if (existsSync(targetPath)) {
        throw new Error(`Repository already exists: ${repoName}`);
      }

      logger.info('Cloning repository', { url: repositoryUrl, name: repoName });

      // Clone repository
      await this.executeGitCommand(['clone', repositoryUrl, repoName], {
        cwd: this.repositoriesPath,
      });

      return {
        success: true,
        repository: repoName,
        path: targetPath,
        message: `Repository cloned successfully: ${repoName}`,
      };
    } catch (error) {
      logger.error('Failed to clone repository', { url: repositoryUrl, error: error.message });
      throw error;
    }
  }

  /**
   * List locally cloned repositories
   * @returns {Promise<Array<Object>>} List of repositories
   */
  async listRepositories() {
    try {
      const repositories = [];

      if (!existsSync(this.repositoriesPath)) {
        return repositories;
      }

      const entries = readdirSync(this.repositoriesPath);

      for (const entry of entries) {
        const entryPath = path.join(this.repositoriesPath, entry);
        const stats = statSync(entryPath);

        if (stats.isDirectory()) {
          // Check if it's a git repository
          const gitPath = path.join(entryPath, '.git');
          if (existsSync(gitPath)) {
            try {
              // Get repository info
              const remoteResult = await this.executeGitCommand(['remote', 'get-url', 'origin'], {
                cwd: entryPath,
              }).catch(() => ({ stdout: 'unknown' }));

              const branchResult = await this.executeGitCommand(['branch', '--show-current'], {
                cwd: entryPath,
              }).catch(() => ({ stdout: 'unknown' }));

              repositories.push({
                name: entry,
                path: entryPath,
                remote: remoteResult.stdout || 'unknown',
                currentBranch: branchResult.stdout || 'unknown',
              });
            } catch (error) {
              logger.warn('Error getting repository info', {
                repository: entry,
                error: error.message,
              });
              repositories.push({
                name: entry,
                path: entryPath,
                remote: 'unknown',
                currentBranch: 'unknown',
              });
            }
          }
        }
      }

      return repositories;
    } catch (error) {
      logger.error('Failed to list repositories', { error: error.message });
      throw error;
    }
  }

  /**
   * Checkout to a branch
   * @param {string} repositoryName - Repository name
   * @param {string} branchName - Branch name to checkout
   * @returns {Promise<Object>} Checkout result
   */
  async checkoutBranch(repositoryName, branchName) {
    try {
      if (!repositoryName || !branchName) {
        throw new Error('Repository name and branch name are required');
      }

      const repositoryPath = path.join(this.repositoriesPath, repositoryName);

      if (!existsSync(repositoryPath)) {
        throw new Error(`Repository not found: ${repositoryName}`);
      }

      logger.info('Checking out branch', { repository: repositoryName, branch: branchName });

      // Checkout branch (create if doesn't exist with -b flag, or just checkout if exists)
      await this.executeGitCommand(['checkout', branchName], {
        cwd: repositoryPath,
      }).catch(async (error) => {
        // If branch doesn't exist, try to create it
        if (error.message.includes('did not match any file')) {
          logger.info('Branch does not exist, creating new branch', { branch: branchName });
          return await this.executeGitCommand(['checkout', '-b', branchName], {
            cwd: repositoryPath,
          });
        }
        throw error;
      });

      return {
        success: true,
        repository: repositoryName,
        branch: branchName,
        message: `Checked out to branch: ${branchName}`,
      };
    } catch (error) {
      logger.error('Failed to checkout branch', {
        repository: repositoryName,
        branch: branchName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Push branch to origin
   * @param {string} repositoryName - Repository name
   * @param {string} branchName - Branch name to push
   * @returns {Promise<Object>} Push result
   */
  async pushBranch(repositoryName, branchName) {
    try {
      if (!repositoryName || !branchName) {
        throw new Error('Repository name and branch name are required');
      }

      const repositoryPath = path.join(this.repositoriesPath, repositoryName);

      if (!existsSync(repositoryPath)) {
        throw new Error(`Repository not found: ${repositoryName}`);
      }

      logger.info('Pushing branch', { repository: repositoryName, branch: branchName });

      const result = await this.executeGitCommand(['push', 'origin', branchName], {
        cwd: repositoryPath,
      });

      return {
        success: true,
        repository: repositoryName,
        branch: branchName,
        message: `Pushed branch ${branchName} to origin`,
        output: result.stdout,
      };
    } catch (error) {
      logger.error('Failed to push branch', {
        repository: repositoryName,
        branch: branchName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Pull branch from origin
   * @param {string} repositoryName - Repository name
   * @param {string} branchName - Branch name to pull
   * @returns {Promise<Object>} Pull result
   */
  async pullBranch(repositoryName, branchName) {
    try {
      if (!repositoryName || !branchName) {
        throw new Error('Repository name and branch name are required');
      }

      const repositoryPath = path.join(this.repositoriesPath, repositoryName);

      if (!existsSync(repositoryPath)) {
        throw new Error(`Repository not found: ${repositoryName}`);
      }

      logger.info('Pulling branch', { repository: repositoryName, branch: branchName });

      // First checkout the branch if not already on it
      await this.checkoutBranch(repositoryName, branchName).catch(() => {
        // Ignore checkout errors, might already be on the branch
      });

      const result = await this.executeGitCommand(['pull', 'origin', branchName], {
        cwd: repositoryPath,
      });

      return {
        success: true,
        repository: repositoryName,
        branch: branchName,
        message: `Pulled branch ${branchName} from origin`,
        output: result.stdout,
      };
    } catch (error) {
      logger.error('Failed to pull branch', {
        repository: repositoryName,
        branch: branchName,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Extract repository name from URL
   * @param {string} url - Repository URL
   * @returns {string} Repository name
   */
  extractRepositoryName(url) {
    // Handle various URL formats:
    // https://github.com/user/repo.git
    // https://github.com/user/repo
    // git@github.com:user/repo.git
    // user/repo
    const match = url.match(/(?:.*\/)?([^/]+?)(?:\.git)?$/);
    return match ? match[1] : 'repository';
  }
}
