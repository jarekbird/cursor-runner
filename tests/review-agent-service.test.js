// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ReviewAgentService } from '../src/review-agent-service.js';

// Mock CursorCLI - we'll create it manually in tests

describe('ReviewAgentService', () => {
  let reviewAgent;
  let mockCursorCLI;

  beforeEach(() => {
    mockCursorCLI = {
      executeCommand: jest.fn(),
    };
    reviewAgent = new ReviewAgentService(mockCursorCLI);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided CursorCLI instance', () => {
      const mockCLI = { executeCommand: jest.fn() };
      const agent = new ReviewAgentService(mockCLI);
      expect(agent.cursorCLI).toBe(mockCLI);
    });
  });

  describe('reviewOutput', () => {
    it('should successfully parse JSON from stdout', async () => {
      const stdout = `Some output before JSON
{
  "code_complete": true,
  "execute_terminal_command": false,
  "terminal_command_requested": null
}
Some output after JSON`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result.code_complete).toBe(true);
      expect(result.execute_terminal_command).toBe(false);
      expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
    });

    it('should extract JSON from mixed output', async () => {
      const stdout = `Log message
Debug info
{"code_complete": false, "execute_terminal_command": true, "terminal_command_requested": "npm test"}
More log output`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result.code_complete).toBe(false);
      expect(result.execute_terminal_command).toBe(true);
      expect(result.terminal_command_requested).toBe('npm test');
    });

    it('should handle valid JSON structure', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        execute_terminal_command: true,
        terminal_command_requested: 'bundle exec rspec',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result.code_complete).toBe(true);
      expect(result.execute_terminal_command).toBe(true);
      expect(result.terminal_command_requested).toBe('bundle exec rspec');
    });

    it('should handle invalid JSON gracefully', async () => {
      const stdout = 'Invalid JSON { code_complete: true }';

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result).toBeNull();
    });

    it('should handle missing JSON in output', async () => {
      const stdout = 'No JSON found in this output';

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result).toBeNull();
    });

    it('should handle cursor CLI execution errors', async () => {
      mockCursorCLI.executeCommand.mockRejectedValue(new Error('Cursor CLI failed'));

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result).toBeNull();
    });

    it('should handle cursor CLI non-zero exit code', async () => {
      mockCursorCLI.executeCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Error occurred',
      });

      // The method doesn't check exitCode, it just tries to parse stdout
      // So this will try to parse empty string and return null
      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result).toBeNull();
    });

    it('should handle different JSON structures', async () => {
      const stdout = JSON.stringify({
        code_complete: false,
        execute_terminal_command: false,
        terminal_command_requested: null,
        notes: 'Additional review notes',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result.code_complete).toBe(false);
      expect(result.execute_terminal_command).toBe(false);
      expect(result.terminal_command_requested).toBe(null);
      expect(result.notes).toBe('Additional review notes');
    });

    it('should handle JSON with escaped characters', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        execute_terminal_command: false,
        terminal_command_requested: null,
        message: 'Review with "quotes" and \n newlines',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      expect(result.code_complete).toBe(true);
      expect(result.message).toBe('Review with "quotes" and \n newlines');
    });

    it('should handle multiple JSON objects in output', async () => {
      const stdout = `First JSON: {"code_complete": false}
Second JSON: {"code_complete": true, "execute_terminal_command": true, "terminal_command_requested": "test"}`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const result = await reviewAgent.reviewOutput('test output', '/path/to/repo');

      // Should extract the last valid JSON
      expect(result.code_complete).toBe(true);
      expect(result.execute_terminal_command).toBe(true);
    });

    it('should pass repository path to cursor CLI', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        execute_terminal_command: false,
        terminal_command_requested: null,
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const repoPath = '/custom/repo/path';
      await reviewAgent.reviewOutput('test output', repoPath);

      expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      const callArgs = mockCursorCLI.executeCommand.mock.calls[0];
      expect(callArgs[1].cwd).toBe(repoPath);
    });

    it('should include output in review prompt', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        execute_terminal_command: false,
        terminal_command_requested: null,
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const testOutput = 'This is the output to review';
      await reviewAgent.reviewOutput(testOutput, '/path/to/repo');

      expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      const callArgs = mockCursorCLI.executeCommand.mock.calls[0];
      const args = callArgs[0];
      const promptArg = args[args.indexOf('--print') + 1];
      expect(promptArg).toContain(testOutput);
    });
  });
});
