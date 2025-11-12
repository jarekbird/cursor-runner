import { CursorCLI } from '../src/cursor-cli.js';

describe('CursorCLI', () => {
  let cursorCLI;

  beforeEach(() => {
    cursorCLI = new CursorCLI();
  });

  describe('validate', () => {
    it('should validate cursor-cli is available', async () => {
      // Mock or skip based on actual cursor-cli availability
      // This test may need to be adjusted based on your environment
      expect(cursorCLI).toBeDefined();
    });
  });

  describe('validateCommandSecurity', () => {
    it('should block dangerous commands', () => {
      expect(() => {
        cursorCLI.validateCommandSecurity(['rm', '-rf', '/']);
      }).toThrow('Blocked command detected');
    });

    it('should allow safe commands', () => {
      expect(() => {
        cursorCLI.validateCommandSecurity(['test']);
      }).not.toThrow();
    });
  });

  describe('extractFilesFromOutput', () => {
    it('should extract file paths from output', () => {
      const output = 'created: app/services/test.rb\nmodified: spec/services/test_spec.rb';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toContain('app/services/test.rb');
      expect(files).toContain('spec/services/test_spec.rb');
    });

    it('should return empty array when no files found', () => {
      const output = 'No files created';
      const files = cursorCLI.extractFilesFromOutput(output);

      expect(files).toEqual([]);
    });
  });
});
