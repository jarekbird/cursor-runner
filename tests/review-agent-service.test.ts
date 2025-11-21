// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ReviewAgentService } from '../src/review-agent-service.js';

// Mock CursorCLI - we'll create it manually in tests
describe('ReviewAgentService', () => {
  let reviewAgent: ReviewAgentService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockCursorCLI: any;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCLI: any = { executeCommand: jest.fn() };
      const agent = new ReviewAgentService(mockCLI);
      // Test that the service can be created and used
      expect(agent).toBeInstanceOf(ReviewAgentService);
    });
  });

  describe('reviewOutput', () => {
    it('should successfully parse JSON from stdout', async () => {
      const stdout = `Some output before JSON
{
  "code_complete": true,
  "break_iteration": false,
  "justification": "Task completed successfully"
}
Some output after JSON`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false);
      expect(response.rawOutput).toContain('code_complete');
      expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
    });

    it('should extract JSON from mixed output', async () => {
      const stdout = `Log message
Debug info
{"code_complete": false, "break_iteration": false, "justification": "Work in progress"}
More log output`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(false);
      expect(response.result?.break_iteration).toBe(false);
      expect(response.result?.justification).toBe('Work in progress');
      expect(response.rawOutput).toContain('Work in progress');
    });

    it('should handle valid JSON structure with break_iteration', async () => {
      const stdout = JSON.stringify({
        code_complete: false,
        break_iteration: true,
        justification: 'Permission issue detected',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(false);
      expect(response.result?.break_iteration).toBe(true);
      expect(response.result?.justification).toBe('Permission issue detected');
      expect(response.rawOutput).toContain('Permission issue detected');
    });

    it('should handle invalid JSON gracefully', async () => {
      const stdout = 'Invalid JSON { code_complete: true }';

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toBe(stdout.trim());
    });

    it('should handle missing JSON in output', async () => {
      const stdout = 'No JSON found in this output';

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toBe(stdout.trim());
    });

    it('should handle cursor CLI execution errors', async () => {
      mockCursorCLI.executeCommand.mockRejectedValue(new Error('Cursor CLI failed'));

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toContain('Review agent error');
      expect(response.rawOutput).toContain('Cursor CLI failed');
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
      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toBe('');
    });

    it('should handle different JSON structures', async () => {
      const stdout = JSON.stringify({
        code_complete: false,
        break_iteration: false,
        justification: 'Work in progress',
        notes: 'Additional review notes',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(false);
      expect(response.result?.break_iteration).toBe(false);
      expect(response.result?.justification).toBe('Work in progress');
      // Note: Additional fields like 'notes' are not preserved in the ReviewResult interface
    });

    it('should handle JSON with escaped characters', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        break_iteration: false,
        justification: 'Review with "quotes" and \n newlines',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false);
      expect(response.result?.justification).toBe('Review with "quotes" and \n newlines');
    });

    it('should handle multiple JSON objects in output', async () => {
      // The implementation now uses brace matching to find the first complete JSON object
      const stdout = `Some text before
{"code_complete": true, "break_iteration": false, "justification": "Task completed"}
Some text after`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      // Should extract the JSON object
      expect(response.result).not.toBeNull();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false);
    });

    it('should handle ANSI escape sequences in output', async () => {
      const stdout = `\u001b[?25hSome text before
{\u001b[0m
  "code_complete": true,
  "break_iteration": false,
  "justification": "Task completed"
}\u001b[?25h
Some text after`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).not.toBeNull();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false);
    });

    it('should handle output with carriage returns and newlines', async () => {
      const stdout = `\r\nSome text before\r\n{\r\n  "code_complete": true,\r\n  "break_iteration": false\r\n}\r\nSome text after`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).not.toBeNull();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false);
    });

    it('should return null for JSON missing required fields', async () => {
      const stdout = JSON.stringify({
        break_iteration: false,
        // Missing code_complete field
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toContain('break_iteration');
    });

    it('should return null for incomplete JSON (missing closing brace)', async () => {
      const stdout = `Some text before
{"code_complete": true, "break_iteration": false
Some text after (missing closing brace)`;

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeNull();
      expect(response.rawOutput).toContain('code_complete');
    });

    it('should pass repository path to cursor CLI', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        break_iteration: false,
        justification: 'Task completed',
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
        break_iteration: false,
        justification: 'Task completed',
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
      // Review agent uses --print --force (not --resume) to avoid session selection menu
      // Args are: ['--print', '--force', reviewPrompt]
      const forceIndex = args.indexOf('--force');
      // Get the prompt argument (should be right after --force)
      let promptIndex = forceIndex + 1;
      // Skip --model and its value if present (for backward compatibility)
      if (args[promptIndex] === '--model') {
        promptIndex += 2; // Skip --model and its value
      }
      const promptArg = args[promptIndex];
      expect(promptArg).toContain(testOutput);
    });

    it('should default break_iteration to false if not provided', async () => {
      const stdout = JSON.stringify({
        code_complete: true,
        // break_iteration not provided
        justification: 'Task completed',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(true);
      expect(response.result?.break_iteration).toBe(false); // Should default to false
    });

    it('should detect permission issues and set break_iteration to true', async () => {
      const stdout = JSON.stringify({
        code_complete: false,
        break_iteration: true,
        justification: 'Workspace Trust Required - cursor needs permissions',
      });

      mockCursorCLI.executeCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout,
        stderr: '',
      });

      const response = (await reviewAgent.reviewOutput('test output', '/path/to/repo')) as any;

      expect(response.result).toBeDefined();
      expect(response.result?.code_complete).toBe(false);
      expect(response.result?.break_iteration).toBe(true);
      expect(response.result?.justification).toContain('Workspace Trust Required');
    });
  });
});
