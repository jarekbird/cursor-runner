import { readdirSync, statSync } from 'fs';
import path from 'path';
import { logger } from './logger.js';

/**
 * File node in the file tree
 */
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

/**
 * Directories and files to ignore when building the file tree
 */
const IGNORED_PATTERNS = [
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.nyc_output',
  '.vscode',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  'env',
  '.env',
  '.DS_Store',
  '*.log',
  '*.tmp',
];

/**
 * Check if a path should be ignored
 */
function shouldIgnore(name: string): boolean {
  return IGNORED_PATTERNS.some((pattern) => {
    if (pattern.includes('*')) {
      // Simple glob pattern matching
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * Service for building file tree structures from repository directories
 */
export class FileTreeService {
  /**
   * Build a nested file tree from a directory path
   * @param dirPath - The directory path to build the tree from
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns FileNode tree structure
   */
  buildFileTree(dirPath: string, maxDepth: number = 10): FileNode[] {
    try {
      return this.buildFileTreeRecursive(dirPath, dirPath, maxDepth, 0);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to build file tree', {
        dirPath,
        error: err.message,
        stack: err.stack,
      });
      throw new Error(`Failed to build file tree: ${err.message}`);
    }
  }

  /**
   * Recursively build file tree
   * @param currentPath - Current directory path being processed
   * @param rootPath - Root directory path (for relative path calculation)
   * @param maxDepth - Maximum depth to traverse
   * @param currentDepth - Current depth in the tree
   * @returns Array of FileNode objects
   */
  private buildFileTreeRecursive(
    currentPath: string,
    rootPath: string,
    maxDepth: number,
    currentDepth: number
  ): FileNode[] {
    if (currentDepth >= maxDepth) {
      return [];
    }

    try {
      const entries = readdirSync(currentPath);
      const nodes: FileNode[] = [];

      for (const entry of entries) {
        // Skip ignored patterns
        if (shouldIgnore(entry)) {
          continue;
        }

        const fullPath = path.join(currentPath, entry);
        const relativePath = path.relative(rootPath, fullPath);

        try {
          const stats = statSync(fullPath);

          if (stats.isDirectory()) {
            const children = this.buildFileTreeRecursive(
              fullPath,
              rootPath,
              maxDepth,
              currentDepth + 1
            );

            nodes.push({
              name: entry,
              path: relativePath,
              type: 'directory',
              children,
            });
          } else if (stats.isFile()) {
            nodes.push({
              name: entry,
              path: relativePath,
              type: 'file',
            });
          }
          // Skip other types (symlinks, etc.)
        } catch (statError) {
          // Skip entries we can't stat (permissions, etc.)
          logger.debug('Skipping entry due to stat error', {
            entry: fullPath,
            error: (statError as Error).message,
          });
        }
      }

      // Sort: directories first, then files, both alphabetically
      return nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      const err = error as Error;
      logger.warn('Failed to read directory', {
        path: currentPath,
        error: err.message,
      });
      return [];
    }
  }
}
