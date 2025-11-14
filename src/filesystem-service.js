import { existsSync as defaultExistsSync } from 'fs';

/**
 * FilesystemService - Wrapper for filesystem operations
 *
 * Provides a testable interface for filesystem operations.
 * Can be mocked in tests by injecting a custom implementation.
 */
export class FilesystemService {
  /**
   * @param {Function} existsFn - Optional dependency-injected exists function (primarily for testing)
   */
  constructor(existsFn = defaultExistsSync) {
    this.existsFn = existsFn;
  }

  /**
   * Check if a path exists
   * @param {string} path - Path to check
   * @returns {boolean} True if path exists
   */
  exists(path) {
    return this.existsFn(path);
  }
}
