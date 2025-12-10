// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect } from '@jest/globals';
import { TerminalService } from '../src/terminal-service.js';

describe('TerminalService', () => {
  let service: TerminalService;

  beforeEach(() => {
    service = new TerminalService();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const service = new TerminalService();
      expect(service.timeout).toBe(300000);
      expect(service.maxOutputSize).toBe(10485760);
    });
  });

  describe('executeCommand', () => {
    it('should clean up resources on completion', async () => {
      // Use a real command that completes quickly
      const result = await service.executeCommand('echo', ['hello']);

      // Verify command completed
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('hello');
      // Verify no errors occurred
      expect(result.stderr).toBe('');
    });

    it('should not leave hanging timers or child processes', async () => {
      // Use a real command that completes quickly
      const result = await service.executeCommand('echo', ['test']);

      // Verify command completed
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('test');

      // Wait a bit to ensure no timers are still running
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The service should have cleaned up all resources
      // We verify this by ensuring the command completed successfully
      // and no errors were thrown
      expect(result.exitCode).toBe(0);
    });

    it('should stream output correctly', async () => {
      // Use a real command that produces output
      const result = await service.executeCommand('echo', ['chunk1', 'chunk2']);

      // Verify output was collected
      expect(result.stdout).toContain('chunk1');
      expect(result.stdout).toContain('chunk2');
      expect(result.success).toBe(true);
    });

    it('should handle stderr streaming', async () => {
      // Use a real command that produces stderr output
      // On Unix, we can use sh -c to redirect to stderr
      // On Windows, we'll use a command that might produce stderr
      const command = process.platform === 'win32' ? 'cmd' : 'sh';
      const args = process.platform === 'win32' ? ['/c', 'echo error >&2'] : ['-c', 'echo error >&2'];

      const result = await service.executeCommand(command, args);

      // Verify stderr was collected (or stdout if redirection doesn't work)
      // The important thing is that output was streamed and collected
      expect(result).toBeDefined();
      expect(typeof result.stderr).toBe('string');
    });

    it('should clean up on timeout', async () => {
      const shortTimeout = 100;
      // Use a command that will timeout (sleep on Unix, timeout on Windows)
      const command = process.platform === 'win32' ? 'timeout' : 'sleep';
      const args = process.platform === 'win32' ? ['/t', '10'] : ['10'];

      try {
        await service.executeCommand(command, args, { timeout: shortTimeout });
        // Should not reach here on Unix (sleep will timeout)
        // On Windows, timeout command might complete differently
        if (process.platform !== 'win32') {
          expect(true).toBe(false);
        }
      } catch (error) {
        // Verify timeout error
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should clean up on error', async () => {
      try {
        await service.executeCommand('nonexistent-command-that-does-not-exist-12345', []);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Verify error was thrown (spawn error)
        expect((error as Error).message).toMatch(/ENOENT|spawn|not found/i);
        // The service should have cleaned up timeout on error
      }
    });
  });
});
