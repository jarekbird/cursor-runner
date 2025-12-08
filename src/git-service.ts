import { existsSync, mkdirSync } from 'fs';
import { logger } from './logger.js';
import { getRepositoriesPath } from './utils/path-resolver.js';

/**
 * GitService - Manages repository path configuration
 *
 * Provides access to the repositories directory path where all repositories are stored.
 * Git operations are now handled by cursor, not by this service.
 */
export class GitService {
  public readonly repositoriesPath: string;

  constructor() {
    // Path is resolved relative to TARGET_APP_PATH
    this.repositoriesPath = getRepositoriesPath();

    // Ensure repositories directory exists
    this.ensureRepositoriesDirectory();
  }

  /**
   * Ensure repositories directory exists
   */
  ensureRepositoriesDirectory(): void {
    if (!existsSync(this.repositoriesPath)) {
      mkdirSync(this.repositoriesPath, { recursive: true });
      logger.info('Created repositories directory', { path: this.repositoriesPath });
    }
  }
}
