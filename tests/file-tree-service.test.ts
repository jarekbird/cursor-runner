// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync, rmdirSync, unlinkSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { FileTreeService } from '../src/file-tree-service.js';

describe('FileTreeService', () => {
  let service: FileTreeService;
  let testDir: string;

  beforeEach(() => {
    service = new FileTreeService();
    testDir = join(process.cwd(), 'test-temp-file-tree');
    // Clean up if exists - use recursive: true to ensure complete removal
    if (existsSync(testDir)) {
      try {
        const files = readdirSync(testDir);
        for (const file of files) {
          const filePath = join(testDir, file);
          const stat = statSync(filePath);
          if (stat.isDirectory()) {
            cleanupDir(filePath);
            rmdirSync(filePath);
          } else {
            unlinkSync(filePath);
          }
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      cleanupDir(testDir);
    }
  });

  function cleanupDir(dir: string): void {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          cleanupDir(filePath);
          rmdirSync(filePath);
        } else {
          unlinkSync(filePath);
        }
      }
      rmdirSync(dir);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  it('should build a simple file tree', () => {
    // Create test structure
    writeFileSync(join(testDir, 'file1.txt'), 'content');
    writeFileSync(join(testDir, 'file2.txt'), 'content');
    mkdirSync(join(testDir, 'subdir'));
    writeFileSync(join(testDir, 'subdir', 'file3.txt'), 'content');

    const tree = service.buildFileTree(testDir);

    expect(tree.length).toBeGreaterThan(0);
    const subdir = tree.find((node) => node.name === 'subdir');
    expect(subdir).toBeDefined();
    expect(subdir?.type).toBe('directory');
    expect(subdir?.children).toBeDefined();
    expect(subdir?.children?.length).toBe(1);
  });

  it('should filter out .git directory', () => {
    mkdirSync(join(testDir, '.git'));
    writeFileSync(join(testDir, '.git', 'config'), 'content');
    writeFileSync(join(testDir, 'file.txt'), 'content');

    const tree = service.buildFileTree(testDir);

    const gitNode = tree.find((node) => node.name === '.git');
    expect(gitNode).toBeUndefined();
    const fileNode = tree.find((node) => node.name === 'file.txt');
    expect(fileNode).toBeDefined();
  });

  it('should filter out node_modules directory', () => {
    mkdirSync(join(testDir, 'node_modules'));
    writeFileSync(join(testDir, 'node_modules', 'package.json'), '{}');
    writeFileSync(join(testDir, 'file.txt'), 'content');

    const tree = service.buildFileTree(testDir);

    const nodeModulesNode = tree.find((node) => node.name === 'node_modules');
    expect(nodeModulesNode).toBeUndefined();
    const fileNode = tree.find((node) => node.name === 'file.txt');
    expect(fileNode).toBeDefined();
  });

  it('should handle empty directories', () => {
    mkdirSync(join(testDir, 'empty-dir'));

    const tree = service.buildFileTree(testDir);

    const emptyDir = tree.find((node) => node.name === 'empty-dir');
    expect(emptyDir).toBeDefined();
    expect(emptyDir?.type).toBe('directory');
    expect(emptyDir?.children).toEqual([]);
  });

  it('should respect maxDepth parameter', () => {
    mkdirSync(join(testDir, 'level1'));
    mkdirSync(join(testDir, 'level1', 'level2'));
    mkdirSync(join(testDir, 'level1', 'level2', 'level3'));
    writeFileSync(join(testDir, 'level1', 'level2', 'level3', 'file.txt'), 'content');

    const tree = service.buildFileTree(testDir, 2);

    const level1 = tree.find((node) => node.name === 'level1');
    expect(level1).toBeDefined();
    const level2 = level1?.children?.find((node) => node.name === 'level2');
    expect(level2).toBeDefined();
    expect(level2?.children).toEqual([]); // Should be empty due to maxDepth
  });

  it('should sort directories before files', () => {
    writeFileSync(join(testDir, 'a-file.txt'), 'content');
    mkdirSync(join(testDir, 'b-dir'));
    writeFileSync(join(testDir, 'z-file.txt'), 'content');

    const tree = service.buildFileTree(testDir);

    expect(tree[0].name).toBe('b-dir');
    expect(tree[0].type).toBe('directory');
  });

  it('should handle nested directory structures', () => {
    mkdirSync(join(testDir, 'src'));
    mkdirSync(join(testDir, 'src', 'components'));
    writeFileSync(join(testDir, 'src', 'components', 'Button.tsx'), 'content');
    writeFileSync(join(testDir, 'src', 'index.ts'), 'content');
    writeFileSync(join(testDir, 'package.json'), '{}');

    const tree = service.buildFileTree(testDir);

    const srcNode = tree.find((node) => node.name === 'src');
    expect(srcNode).toBeDefined();
    expect(srcNode?.type).toBe('directory');
    const componentsNode = srcNode?.children?.find((node) => node.name === 'components');
    expect(componentsNode).toBeDefined();
    expect(componentsNode?.children?.length).toBe(1);
  });

  it('should set correct path values', () => {
    // Ensure subdir doesn't exist from previous test
    const subdirPath = join(testDir, 'subdir');
    if (existsSync(subdirPath)) {
      cleanupDir(subdirPath);
    }
    mkdirSync(subdirPath, { recursive: true });
    writeFileSync(join(subdirPath, 'file.txt'), 'content');

    const tree = service.buildFileTree(testDir);

    const subdir = tree.find((node) => node.name === 'subdir');
    expect(subdir).toBeDefined();
    expect(subdir?.path).toBe('subdir');
    const file = subdir?.children?.find((node) => node.name === 'file.txt');
    expect(file).toBeDefined();
    expect(file?.path).toBe('subdir/file.txt');
  });
});

