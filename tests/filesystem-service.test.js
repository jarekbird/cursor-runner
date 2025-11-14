// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { FilesystemService } from '../src/filesystem-service.js';

describe('FilesystemService', () => {
  let filesystemService;
  let mockExistsFn;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsFn = jest.fn();
    filesystemService = new FilesystemService(mockExistsFn);
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
  });
});
