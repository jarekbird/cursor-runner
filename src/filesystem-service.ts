import { existsSync as defaultExistsSync } from 'fs';

/**
 * FilesystemService - Wrapper for filesystem operations
 *
 * Provides a testable interface for filesystem operations.
 * Can be mocked in tests by injecting a custom implementation.
 */
type ExistsFunction = (path: string | Buffer) => boolean;

export class FilesystemService {
  private existsFn: ExistsFunction;

  /**
   * @param existsFn - Optional dependency-injected exists function (primarily for testing)
   */
  constructor(existsFn: ExistsFunction = defaultExistsSync) {
    this.existsFn = existsFn;
  }

  /**
   * Check if a path exists
   * @param path - Path to check
   * @returns True if path exists
   */
  exists(path: string): boolean {
    return this.existsFn(path);
  }
}
