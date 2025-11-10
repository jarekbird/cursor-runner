import { existsSync } from 'fs';

/**
 * FilesystemService - Wrapper for filesystem operations
 * 
 * Provides a testable interface for filesystem operations.
 * Can be mocked in tests by injecting a custom implementation.
 */
export class FilesystemService {
  /**
   * Check if a path exists
   * @param {string} path - Path to check
   * @returns {boolean} True if path exists
   */
  exists(path) {
    return existsSync(path);
  }
}

