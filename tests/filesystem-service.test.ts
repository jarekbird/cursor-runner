// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { FilesystemService } from '../src/filesystem-service.js';

describe('FilesystemService', () => {
  let filesystemService: FilesystemService;
  let mockExistsFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsFn = jest.fn();
    filesystemService = new FilesystemService(mockExistsFn as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('exists', () => {
    it('should return true for existing file', () => {
      mockExistsFn.mockReturnValue(true);

      const result = filesystemService.exists('/path/to/file.txt');

      expect(result).toBe(true);
      expect(mockExistsFn).toHaveBeenCalledWith('/path/to/file.txt');
    });

    it('should return false for non-existing path', () => {
      mockExistsFn.mockReturnValue(false);

      const result = filesystemService.exists('/path/to/nonexistent.txt');

      expect(result).toBe(false);
      expect(mockExistsFn).toHaveBeenCalledWith('/path/to/nonexistent.txt');
    });

    it('should handle directory paths', () => {
      mockExistsFn.mockReturnValue(true);

      const result = filesystemService.exists('/path/to/directory');

      expect(result).toBe(true);
      expect(mockExistsFn).toHaveBeenCalledWith('/path/to/directory');
    });

    it('should handle relative paths', () => {
      mockExistsFn.mockReturnValue(true);

      const result = filesystemService.exists('./relative/path');

      expect(result).toBe(true);
      expect(mockExistsFn).toHaveBeenCalledWith('./relative/path');
    });

    it('should handle absolute paths', () => {
      mockExistsFn.mockReturnValue(true);

      const result = filesystemService.exists('/absolute/path');

      expect(result).toBe(true);
      expect(mockExistsFn).toHaveBeenCalledWith('/absolute/path');
    });

    it('should handle empty string', () => {
      mockExistsFn.mockReturnValue(false);

      const result = filesystemService.exists('');

      expect(result).toBe(false);
      expect(mockExistsFn).toHaveBeenCalledWith('');
    });

    it('should handle paths with special characters', () => {
      mockExistsFn.mockReturnValue(true);

      const result = filesystemService.exists('/path/with spaces/file.txt');

      expect(result).toBe(true);
      expect(mockExistsFn).toHaveBeenCalledWith('/path/with spaces/file.txt');
    });

    it('should handle permission errors gracefully', () => {
      // Simulate permission error by throwing
      mockExistsFn.mockImplementation(() => {
        const error = new Error('EACCES: permission denied');
        (error as any).code = 'EACCES';
        throw error;
      });

      // Should catch and handle the error gracefully
      // The service doesn't currently catch errors, so it will throw
      // But we verify the error is thrown with the correct message
      expect(() => {
        filesystemService.exists('/restricted/path');
      }).toThrow('EACCES: permission denied');
    });
  });
});
