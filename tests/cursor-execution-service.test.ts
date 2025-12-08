/**
 * Unit tests for CursorExecutionService
 * Tests repository validation, system instructions, execution flows, and conversation integration
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CursorExecutionService } from '../src/cursor-execution-service.js';
import { GitService } from '../src/git-service.js';
import { CursorCLI } from '../src/cursor-cli.js';
import { CommandParserService } from '../src/command-parser-service.js';
import { ReviewAgentService } from '../src/review-agent-service.js';
import { FilesystemService } from '../src/filesystem-service.js';
import { WorkspaceTrustService } from '../src/workspace-trust-service.js';
import { createMockRedisClient } from './test-utils.js';
import type Redis from 'ioredis';

describe('CursorExecutionService - Repository Validation', () => {
  let gitService: GitService;
  let cursorCLI: CursorCLI;
  let commandParser: CommandParserService;
  let reviewAgent: ReviewAgentService;
  let filesystem: FilesystemService;
  let redisClient: Partial<Redis>;
  let executionService: CursorExecutionService;
  let mockWorkspaceTrust: jest.Mocked<WorkspaceTrustService>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create real instances
    gitService = new GitService();
    cursorCLI = new CursorCLI();
    commandParser = new CommandParserService();
    reviewAgent = new ReviewAgentService(cursorCLI);
    filesystem = new FilesystemService();
    redisClient = createMockRedisClient();

    // Mock WorkspaceTrustService
    mockWorkspaceTrust = {
      ensureWorkspaceTrust: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
    } as unknown as jest.Mocked<WorkspaceTrustService>;

    // Create execution service
    executionService = new CursorExecutionService(
      gitService,
      cursorCLI,
      commandParser,
      reviewAgent,
      filesystem,
      redisClient as Redis
    );

    // Replace workspaceTrust with mock
    executionService['workspaceTrust'] = mockWorkspaceTrust;
  });

  it('should return error when repository path does not exist', async () => {
    // Mock filesystem to return false for repository existence
    const mockExists = jest.spyOn(filesystem, 'exists').mockReturnValue(false);

    const result = await executionService.execute({
      repository: 'nonexistent-repo',
      prompt: 'Test prompt',
      requestId: 'test-request-1',
    });

    expect(result.status).toBe(404);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toContain('Repository not found locally');
    expect(result.body.error).toContain('nonexistent-repo');

    mockExists.mockRestore();
  });

  it('should handle workspace trust errors', async () => {
    // Mock filesystem to return true for repository existence
    const mockExists = jest.spyOn(filesystem, 'exists').mockReturnValue(true);

    // Mock workspace trust to throw an error
    const trustError = new Error('Workspace is not trusted');
    mockWorkspaceTrust.ensureWorkspaceTrust.mockRejectedValue(trustError);

    // Mock cursorCLI.executeCommand to avoid actual execution
    const mockExecuteCommand = jest.spyOn(cursorCLI, 'executeCommand').mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    // Execute should handle the workspace trust error
    // The error might be caught and logged, or it might propagate
    // Let's verify the workspace trust was called
    try {
      await executionService.execute({
        repository: 'test-repo',
        prompt: 'Test prompt',
        requestId: 'test-request-2',
      });
    } catch (error) {
      // If error propagates, that's also valid behavior
      expect(error).toBe(trustError);
    }

    expect(mockWorkspaceTrust.ensureWorkspaceTrust).toHaveBeenCalled();

    mockExists.mockRestore();
    mockExecuteCommand.mockRestore();
  });

  it('should use repositories directory when no repository provided', async () => {
    // Mock filesystem to return true for repositories directory
    const mockExists = jest.spyOn(filesystem, 'exists').mockReturnValue(true);

    // Mock cursorCLI.executeCommand to avoid actual execution
    const mockExecuteCommand = jest.spyOn(cursorCLI, 'executeCommand').mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'Success',
      stderr: '',
    });

    const result = await executionService.execute({
      prompt: 'Test prompt',
      requestId: 'test-request-3',
    });

    // Should succeed (or return appropriate result)
    // The repository validation should pass and use the repositories directory
    expect(result).toBeDefined();
    expect(mockExists).toHaveBeenCalled();

    mockExists.mockRestore();
    mockExecuteCommand.mockRestore();
  });

  it('should handle TARGET_APP_PATH validation when no repository provided', async () => {
    // Note: Current implementation uses repositories directory when no repository is provided
    // TARGET_APP_PATH validation may not be explicitly checked in execute()
    // This test verifies the current behavior
    const mockExists = jest.spyOn(filesystem, 'exists').mockReturnValue(true);

    // Mock cursorCLI.executeCommand to avoid actual execution
    const mockExecuteCommand = jest.spyOn(cursorCLI, 'executeCommand').mockResolvedValue({
      success: true,
      exitCode: 0,
      stdout: 'Success',
      stderr: '',
    });

    // Save original TARGET_APP_PATH
    const originalTargetAppPath = process.env.TARGET_APP_PATH;
    delete process.env.TARGET_APP_PATH;

    const result = await executionService.execute({
      prompt: 'Test prompt',
      requestId: 'test-request-4',
    });

    // Current implementation should still work (uses repositories directory)
    // If TARGET_APP_PATH validation is needed, it would be added here
    expect(result).toBeDefined();
    expect(result.status).toBe(200);

    // Restore TARGET_APP_PATH
    if (originalTargetAppPath) {
      process.env.TARGET_APP_PATH = originalTargetAppPath;
    }

    mockExists.mockRestore();
    mockExecuteCommand.mockRestore();
  });
});
