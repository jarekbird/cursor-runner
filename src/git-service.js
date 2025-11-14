import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * GitService - Manages repository path configuration
 *
 * Provides access to the repositories directory path where all repositories are stored.
 * Git operations are now handled by cursor, not by this service.
 */
export class GitService {
  constructor() {
    this.repositoriesPath =
      process.env.REPOSITORIES_PATH || path.join(process.cwd(), 'repositories');

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
}
