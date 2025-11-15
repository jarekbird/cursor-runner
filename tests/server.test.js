// eslint-disable-next-line node/no-unpublished-import
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
// eslint-disable-next-line node/no-unpublished-import
import request from 'supertest';
import { Server } from '../src/server.js';

describe('Server', () => {
  let server;
  let app;
  let mockGitService;
  let mockCursorCLI;
  let mockTerminalService;
  let mockFilesystem;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Clear ENABLE_TERMINAL_COMMANDS to ensure default behavior (false)
    delete process.env.ENABLE_TERMINAL_COMMANDS;

    // Create mock git service
    mockGitService = {
      repositoriesPath: '/test/repositories',
    };

    // Create mock cursor CLI
    mockCursorCLI = {
      executeCommand: jest.fn(),
      validate: jest.fn(),
    };

    // Create mock terminal service
    mockTerminalService = {
      executeCommand: jest.fn(),
    };

    // Create mock filesystem service
    mockFilesystem = {
      exists: jest.fn().mockReturnValue(true), // Default: repository exists
    };

    // Create server instance
    server = new Server();
    app = server.app;

    // Replace services with our mocks
    server.gitService = mockGitService;
    server.cursorCLI = mockCursorCLI;
    server.terminalService = mockTerminalService;
    server.filesystem = mockFilesystem;
    // Update cursorExecution with all mocked services
    server.cursorExecution.gitService = mockGitService;
    server.cursorExecution.cursorCLI = mockCursorCLI;
    server.cursorExecution.terminalService = mockTerminalService;
    server.cursorExecution.filesystem = mockFilesystem;
    // Update reviewAgent with mocked cursorCLI
    server.reviewAgent.cursorCLI = mockCursorCLI;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  describe('Health Check', () => {
    it('GET /health should return server status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'cursor-runner',
      });
    });
  });

  describe('Cursor Execution Endpoints', () => {
    describe('POST /cursor/execute', () => {
      it('should execute cursor command successfully', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBe('main');
        expect(response.body.output).toBe('Generated code successfully');
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
      });

      it('should work without repository (uses repositories directory)', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBeUndefined();
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        // Verify it uses repositories directory (not a subdirectory)
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][1];
        expect(callArgs.cwd).toBe('/test/repositories');
      });

      it('should work with empty string repository (uses repositories directory)', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: '',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][1];
        expect(callArgs.cwd).toBe('/test/repositories');
      });

      it('should work without branchName', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBeUndefined();
      });

      it('should include branchName in response when provided', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code successfully',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'feature-branch',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBe('feature-branch');
      });

      it('should return 400 if prompt is missing', async () => {
        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('prompt is required');
      });

      it('should return 404 if repository does not exist locally', async () => {
        mockFilesystem.exists.mockReturnValue(false);

        const response = await request(app).post('/cursor/execute').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Repository not found locally');
      });

      it('should not append terminal instructions by default', async () => {
        // Set terminalInstructions to empty string (default behavior)
        server.cursorExecution.terminalInstructions = '';

        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Output',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create service',
        });

        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][0];
        const promptIndex = callArgs.findIndex((arg) => arg === '--print');
        expect(promptIndex).toBeGreaterThan(-1);
        expect(callArgs[promptIndex + 1]).toContain('Create service');
        expect(callArgs[promptIndex + 1]).not.toContain('If you need to run a terminal command');
      });

      it('should append terminal instructions when ENABLE_TERMINAL_COMMANDS is true', async () => {
        // Set terminalInstructions to include the wrapper text (when enabled)
        server.cursorExecution.terminalInstructions =
          '\n\nIf you need to run a terminal command, stop and request that the caller run the terminal command for you. Be explicit about what terminal command needs to be run.';

        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Output',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create service',
        });

        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][0];
        const promptIndex = callArgs.findIndex((arg) => arg === '--print');
        expect(promptIndex).toBeGreaterThan(-1);
        expect(callArgs[promptIndex + 1]).toContain('Create service');
        expect(callArgs[promptIndex + 1]).toContain('If you need to run a terminal command');
      });

      it('should handle command execution errors', async () => {
        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockRejectedValue(new Error('Command failed'));

        const response = await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(500);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Command failed');
      });

      it('should parse command with quoted arguments', async () => {
        const mockResult = {
          success: true,
          exitCode: 0,
          stdout: 'Output',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand.mockResolvedValue(mockResult);

        await request(app).post('/cursor/execute').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service with authentication',
        });

        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][0];
        expect(callArgs).toContain('--print');
        // The prompt argument will have instructions appended, so check that it contains the original text
        const promptArg = callArgs[callArgs.indexOf('--print') + 1];
        expect(promptArg).toContain('Create user service with authentication');
      });
    });

    describe('POST /cursor/iterate', () => {
      it('should execute iterate successfully with single iteration', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.iterations).toBe(0); // No iterations needed, completed immediately
        expect(response.body.output).toBe('Code generated successfully');
        expect(mockCursorCLI.executeCommand).toHaveBeenCalledTimes(2); // Initial + review
      });

      it('should iterate when code is not complete', async () => {
        // Enable terminal commands for this test
        server.cursorExecution.enableTerminalCommands = true;

        const mockCursorResult1 = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code, but needs testing',
          stderr: '',
        };

        const mockReviewResult1 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            execute_terminal_command: true,
            terminal_command_requested: 'bundle exec rspec spec',
            justification: 'Tests need to be run',
          }),
          stderr: '',
        };

        const mockTerminalResult = {
          success: true,
          exitCode: 0,
          stdout: 'Tests passed',
          stderr: '',
        };

        const mockCursorResult2 = {
          success: true,
          exitCode: 0,
          stdout: 'Code completed after tests',
          stderr: '',
        };

        const mockReviewResult2 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'All done',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockTerminalService.executeCommand.mockResolvedValue(mockTerminalResult);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult1) // Initial command
          .mockResolvedValueOnce(mockReviewResult1) // First review
          .mockResolvedValueOnce(mockCursorResult2) // Resume command
          .mockResolvedValueOnce(mockReviewResult2); // Second review

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'Create user service',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.iterations).toBe(1);
        expect(response.body.output).toBe('Code completed after tests');
        expect(mockTerminalService.executeCommand).toHaveBeenCalledWith(
          'bundle',
          ['exec', 'rspec', 'spec'],
          expect.any(Object)
        );
        expect(mockCursorCLI.executeCommand).toHaveBeenCalledTimes(4); // Initial + review + resume + review
      });

      it('should work without repository (uses repositories directory)', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate').send({
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBeUndefined();
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        // Verify it uses repositories directory
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][1];
        expect(callArgs.cwd).toBe('/test/repositories');
      });

      it('should work with empty string repository (uses repositories directory)', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate').send({
          repository: '',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(mockCursorCLI.executeCommand).toHaveBeenCalled();
        const callArgs = mockCursorCLI.executeCommand.mock.calls[0][1];
        expect(callArgs.cwd).toBe('/test/repositories');
      });

      it('should work without branchName', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Code generated successfully',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Task completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command
          .mockResolvedValueOnce(mockReviewResult); // Review agent

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          prompt: 'Create user service',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.repository).toBe('test-repo');
        expect(response.body.branchName).toBeUndefined();
      });

      it('should return 400 if prompt is missing', async () => {
        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
        });

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('prompt is required');
      });

      it('should return 404 if repository does not exist locally', async () => {
        mockFilesystem.exists.mockReturnValue(false);

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'nonexistent-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(404);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Repository not found locally');
      });

      it('should handle terminal command execution errors', async () => {
        // Enable terminal commands for this test
        server.cursorExecution.enableTerminalCommands = true;

        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            execute_terminal_command: true,
            terminal_command_requested: 'bundle exec rspec spec',
            justification: 'Need to run tests',
          }),
          stderr: '',
        };

        const mockResumeResult = {
          success: true,
          exitCode: 0,
          stdout: 'Continued after terminal error',
          stderr: '',
        };

        const mockFinalReview = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Completed',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockTerminalService.executeCommand.mockRejectedValue(new Error('Command not found'));
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult)
          .mockResolvedValueOnce(mockReviewResult)
          .mockResolvedValueOnce(mockResumeResult)
          .mockResolvedValueOnce(mockFinalReview);

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(mockTerminalService.executeCommand).toHaveBeenCalled();
      });

      it('should stop after max iterations', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Still working',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Still in progress',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);

        // Set up mocks: initial command, then review, then 25 iterations of (resume + review)
        const mockCalls = [
          mockCursorResult, // Initial command
          mockReviewResult, // First review
        ];

        // Add 25 iterations (each iteration = resume + review)
        for (let i = 0; i < 25; i++) {
          mockCalls.push(mockCursorResult); // Resume
          mockCalls.push(mockReviewResult); // Review
        }

        mockCursorCLI.executeCommand.mockImplementation(() => {
          const result = mockCalls.shift();
          return Promise.resolve(result || mockCursorResult);
        });

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.iterations).toBe(25);
        expect(response.body.maxIterations).toBe(25);
      });

      it('should return 422 when max iterations reached but last result failed', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Still working',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Still in progress',
          }),
          stderr: '',
        };

        const mockFailedResult = {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Command failed at max iterations',
        };

        mockFilesystem.exists.mockReturnValue(true);

        // Set up mocks: initial command, then review, then 24 successful iterations,
        // then one failed resume command
        const mockCalls = [
          mockCursorResult, // Initial command
          mockReviewResult, // First review
        ];

        // Add 24 successful iterations (each iteration = resume + review)
        for (let i = 0; i < 24; i++) {
          mockCalls.push(mockCursorResult); // Resume
          mockCalls.push(mockReviewResult); // Review
        }

        // Last iteration fails
        mockCalls.push(mockFailedResult); // Failed resume

        mockCursorCLI.executeCommand.mockImplementation(() => {
          const result = mockCalls.shift();
          return Promise.resolve(result || mockCursorResult);
        });

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Command failed at max iterations');
        expect(response.body.iterations).toBe(25);
        expect(response.body.maxIterations).toBe(25);
      });

      it('should handle review agent JSON parsing failures', async () => {
        const mockCursorResult = {
          success: true,
          exitCode: 0,
          stdout: 'Generated code',
          stderr: '',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: 'Invalid JSON response',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult)
          .mockResolvedValueOnce(mockReviewResult);

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Failed to parse review agent output');
        expect(response.body.iterations).toBe(0); // Should break on review failure
      });

      it('should return 422 when cursor command fails (e.g., authentication error)', async () => {
        const mockCursorResult = {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr:
            "Error: Authentication required. Please run 'cursor-agent login' first, or set CURSOR_API_KEY environment variable.",
        };

        // Review agent fails to parse (returns invalid JSON), so we get iteration error
        // which takes precedence over the initial command error
        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: 'Invalid JSON response',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command fails
          .mockResolvedValueOnce(mockReviewResult); // Review agent returns invalid JSON

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        // When review parsing fails, iteration error takes precedence
        expect(response.body.error).toContain('Failed to parse review agent output');
        expect(response.body.iterations).toBe(0);
      });

      it('should return 422 when cursor command fails and review parsing also fails', async () => {
        const mockCursorResult = {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Authentication required.',
        };

        const mockReviewResult = {
          success: true,
          exitCode: 0,
          stdout: 'Invalid JSON response',
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult) // Initial command fails
          .mockResolvedValueOnce(mockReviewResult); // Review agent returns invalid JSON

        const response = await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        expect(response.status).toBe(422);
        expect(response.body.success).toBe(false);
        // Should prefer iteration error (review parsing failure) over command error
        expect(response.body.error).toContain('Failed to parse review agent output');
        expect(response.body.iterations).toBe(0);
      });

      it('should include terminal output in resume prompt', async () => {
        // Enable terminal commands for this test
        server.cursorExecution.enableTerminalCommands = true;

        const mockCursorResult1 = {
          success: true,
          exitCode: 0,
          stdout: 'Initial code',
          stderr: '',
        };

        const mockReviewResult1 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: false,
            execute_terminal_command: true,
            terminal_command_requested: 'bundle exec rspec',
            justification: 'Run tests',
          }),
          stderr: '',
        };

        const mockTerminalResult = {
          success: true,
          exitCode: 0,
          stdout: 'Test output: 10 examples, 0 failures',
          stderr: '',
        };

        const mockCursorResult2 = {
          success: true,
          exitCode: 0,
          stdout: 'Continued work',
          stderr: '',
        };

        const mockReviewResult2 = {
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            code_complete: true,
            execute_terminal_command: false,
            terminal_command_requested: null,
            justification: 'Done',
          }),
          stderr: '',
        };

        mockFilesystem.exists.mockReturnValue(true);
        mockTerminalService.executeCommand.mockResolvedValue(mockTerminalResult);
        mockCursorCLI.executeCommand
          .mockResolvedValueOnce(mockCursorResult1)
          .mockResolvedValueOnce(mockReviewResult1)
          .mockResolvedValueOnce(mockCursorResult2)
          .mockResolvedValueOnce(mockReviewResult2);

        await request(app).post('/cursor/iterate').send({
          repository: 'test-repo',
          branchName: 'main',
          prompt: 'test',
        });

        // Check that resume command includes terminal output
        // The resume call should be the 3rd call (after initial command and review)
        expect(mockCursorCLI.executeCommand).toHaveBeenCalledTimes(4);
        const resumeCall = mockCursorCLI.executeCommand.mock.calls[2];
        expect(resumeCall).toBeDefined();
        expect(resumeCall[0]).toEqual([
          '--resume',
          expect.stringContaining('Test output: 10 examples, 0 failures'),
        ]);
      });
    });
  });

  describe('Telegram Webhook Endpoints', () => {
    describe('POST /telegram/webhook', () => {
      it('should receive and acknowledge message update', async () => {
        const messageUpdate = {
          message: {
            message_id: 1,
            text: '/start',
            chat: { id: 123456 },
            from: { id: 789, username: 'test_user' },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(messageUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('message');
        expect(response.body.timestamp).toBeDefined();
      });

      it('should receive and acknowledge edited_message update', async () => {
        const editedUpdate = {
          edited_message: {
            message_id: 2,
            text: 'edited text',
            chat: { id: 123456 },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(editedUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('edited_message');
      });

      it('should receive and acknowledge callback_query update', async () => {
        const callbackUpdate = {
          callback_query: {
            id: 'callback-123',
            data: 'button_clicked',
            message: {
              message_id: 3,
              chat: { id: 123456 },
            },
          },
        };

        const response = await request(app).post('/telegram/webhook').send(callbackUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('callback_query');
      });

      it('should handle unknown update types', async () => {
        const unknownUpdate = {
          some_unknown_type: {
            data: 'unknown',
          },
        };

        const response = await request(app).post('/telegram/webhook').send(unknownUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('unknown');
      });

      it('should handle empty update', async () => {
        const emptyUpdate = {};

        const response = await request(app).post('/telegram/webhook').send(emptyUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
        expect(response.body.updateType).toBe('unknown');
      });

      it('should handle malformed JSON gracefully', async () => {
        // This test ensures the endpoint doesn't crash on unexpected data
        const malformedUpdate = {
          message: null,
          edited_message: undefined,
        };

        const response = await request(app).post('/telegram/webhook').send(malformedUpdate);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.received).toBe(true);
      });

      it('should return 200 even if processing fails', async () => {
        // Create an update that might cause issues
        const problematicUpdate = {
          message: {
            // Missing required fields but should still be handled
          },
        };

        const response = await request(app).post('/telegram/webhook').send(problematicUpdate);

        // Should still return 200 to avoid retries
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });
});
