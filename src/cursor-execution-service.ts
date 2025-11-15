import path from 'path';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';
import { getWebhookSecret } from './callback-url-builder.js';
import { WorkspaceTrustService } from './workspace-trust-service.js';
import { getErrorMessage } from './error-utils.js';
import type { GitService } from './git-service.js';
import type { CursorCLI, CommandResult } from './cursor-cli.js';
import type { CommandParserService } from './command-parser-service.js';
import type { ReviewAgentService } from './review-agent-service.js';

/**
 * Parameters for execute method
 */
export interface ExecuteParams {
  repository?: string | null;
  branchName?: string;
  prompt: string;
  requestId: string;
  callbackUrl?: string;
}

/**
 * Parameters for iterate method
 */
export interface IterateParams {
  repository?: string | null;
  branchName?: string;
  prompt: string;
  requestId: string;
  maxIterations?: number;
  callbackUrl?: string;
}

/**
 * Error response body (discriminated union member)
 */
interface ErrorResponseBody {
  success: false;
  error: string;
}

/**
 * Success response body (discriminated union member)
 */
interface SuccessResponseBody {
  success: true;
  requestId: string;
  repository?: string | null;
  branchName?: string;
  command?: readonly string[];
  output?: string;
  error?: string | null;
  exitCode?: number;
  duration: string;
  timestamp: string;
  iterations?: number;
  maxIterations?: number;
  reviewJustification?: string;
  originalOutput?: string;
}

/**
 * Error response structure (discriminated union)
 */
interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
  requestId?: string;
}

/**
 * Success response structure (discriminated union)
 */
interface SuccessResponse {
  status: number;
  body: SuccessResponseBody;
}

/**
 * Validation result - either an error response or repository path info
 */
type ValidationResult = ErrorResponse | null;

/**
 * Repository validation result
 */
interface RepositoryValidationResult {
  status?: number;
  body?: {
    success: false;
    error: string;
  };
  fullRepositoryPath?: string;
}

/**
 * Execution result
 */
type ExecutionResult = ErrorResponse | SuccessResponse;

/**
 * Iteration result
 */
type IterationResult = ErrorResponse | SuccessResponse;

/**
 * Command error with output properties
 */
interface CommandError extends Error {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

/**
 * Type guard to check if an error is a CommandError
 */
function isCommandError(error: unknown): error is CommandError {
  return error instanceof Error && ('stdout' in error || 'stderr' in error || 'exitCode' in error);
}

/**
 * Review result structure
 */
interface ReviewResult {
  code_complete: boolean;
  break_iteration: boolean;
  justification?: string;
}

/**
 * Callback webhook payload - can be success or error response body
 */
type CallbackWebhookPayload =
  | SuccessResponseBody
  | {
      success: false;
      requestId: string;
      repository?: string | null;
      error: string;
      exitCode?: number;
      duration?: string;
      timestamp: string;
      iterations?: number;
      maxIterations?: number;
      output?: string;
      reviewJustification?: string;
      originalOutput?: string;
    };

/**
 * CursorExecutionService - Orchestrates cursor command execution
 *
 * Handles repository validation, command preparation,
 * and execution coordination for both single and iterative cursor commands.
 */
export class CursorExecutionService {
  private gitService: GitService;
  private cursorCLI: CursorCLI;
  private commandParser: CommandParserService;
  private reviewAgent: ReviewAgentService;
  private filesystem: FilesystemService;
  private workspaceTrust: WorkspaceTrustService;

  constructor(
    gitService: GitService,
    cursorCLI: CursorCLI,
    commandParser: CommandParserService,
    reviewAgent: ReviewAgentService,
    filesystem: FilesystemService | null = null
  ) {
    this.gitService = gitService;
    this.cursorCLI = cursorCLI;
    this.commandParser = commandParser;
    this.reviewAgent = reviewAgent;
    this.filesystem = filesystem || new FilesystemService();
    this.workspaceTrust = new WorkspaceTrustService(this.filesystem);
  }

  /**
   * Validate execution request parameters
   * @param params - Request parameters
   * @returns Error response or null if valid
   */
  validateRequest(params: { prompt?: string }): ValidationResult {
    const { prompt } = params;

    if (!prompt) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'prompt is required',
        },
      };
    }

    return null;
  }

  /**
   * Validate repository exists locally or return repositories directory
   * @param repository - Repository name (optional)
   * @returns Error response or { fullRepositoryPath } if valid
   */
  validateRepository(repository?: string | null): RepositoryValidationResult {
    const repositoryPath = this.gitService.repositoriesPath;

    // If no repository provided, use the repositories directory itself
    if (!repository || (typeof repository === 'string' && repository.trim() === '')) {
      return { fullRepositoryPath: repositoryPath };
    }

    // If repository provided, validate it exists
    const fullRepositoryPath = path.join(repositoryPath, repository);

    if (!this.filesystem.exists(fullRepositoryPath)) {
      return {
        status: 404,
        body: {
          success: false,
          error: `Repository not found locally: ${repository}. Please ensure the repository exists in the repositories directory.`,
        },
      };
    }

    return { fullRepositoryPath };
  }

  /**
   * Prepare command with instructions
   * @param command - Original command string
   * @returns Prepared command arguments
   */
  prepareCommand(command: string): readonly string[] {
    const commandArgs = this.commandParser.parseCommand(command);
    return commandArgs;
  }

  /**
   * Execute a single cursor command
   * @param params - Execution parameters
   * @param params.repository - Repository name (optional, uses repositories directory if not provided)
   * @param params.branchName - Optional branch name (for logging/tracking)
   * @param params.prompt - Prompt string
   * @param params.requestId - Request ID
   * @param params.callbackUrl - Optional callback URL to notify when complete
   * @returns Execution result
   */
  async execute(params: ExecuteParams): Promise<ExecutionResult> {
    const { repository, branchName, prompt, requestId, callbackUrl } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ prompt });
    if (validationError) {
      // If callback URL is provided, notify about validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            error: validationError.body?.error || 'Validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for validation error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      return { ...validationError, requestId };
    }

    // Validate repository exists or use repositories directory
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      // If callback URL is provided, notify about repository validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            error: repoValidation.body?.error || 'Repository validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for repository error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      const errorResponse: ErrorResponse = {
        status: repoValidation.status,
        body: repoValidation.body || {
          success: false,
          error: 'Repository validation error',
        },
        requestId,
      };
      return errorResponse;
    }
    const fullRepositoryPath = repoValidation.fullRepositoryPath;
    if (!fullRepositoryPath) {
      const errorResponse: ErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: 'Failed to determine repository path',
        },
        requestId,
      };
      return errorResponse;
    }

    // Ensure workspace trust is configured before executing commands
    await this.workspaceTrust.ensureWorkspaceTrust(fullRepositoryPath);

    // Construct command from prompt with --force to enable actual file operations
    // --print runs in non-interactive mode (required for automation)
    // Note: Don't use --resume for initial commands as it triggers session selection menu
    // --force enables file modifications
    const command = `--print --force "${prompt}"`;

    // Prepare command
    const modifiedArgs = this.prepareCommand(command);

    // Execute cursor command
    logger.info('Executing cursor command', {
      requestId,
      repository,
      branchName,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
    });

    const result = await this.cursorCLI.executeCommand([...modifiedArgs], {
      cwd: fullRepositoryPath,
    });

    const duration = Date.now() - startTime;
    logger.info('Cursor execution completed', {
      requestId,
      repository,
      branchName,
      success: result.success,
      duration: `${duration}ms`,
    });

    const responseBody: SuccessResponseBody = {
      success: true,
      requestId,
      repository,
      command: modifiedArgs,
      output: result.stdout || '',
      error: result.stderr || null,
      exitCode: result.exitCode || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };

    // Include branchName in response if provided
    if (branchName) {
      responseBody.branchName = branchName;
    }

    // If callback URL is provided, call it asynchronously (don't wait)
    if (callbackUrl) {
      this.callbackWebhook(callbackUrl, responseBody, requestId).catch((error) => {
        logger.error('Failed to call callback webhook', {
          requestId,
          callbackUrl,
          error: getErrorMessage(error),
        });
      });
    }

    return {
      status: 200,
      body: responseBody,
    };
  }

  /**
   * Execute cursor command iteratively until completion
   * @param params - Execution parameters
   * @param params.repository - Repository name (optional, uses repositories directory if not provided)
   * @param params.branchName - Optional branch name (for logging/tracking)
   * @param params.prompt - Prompt string
   * @param params.requestId - Request ID
   * @param params.maxIterations - Maximum iterations (default: 25)
   * @param params.callbackUrl - Optional callback URL to notify when complete
   * @returns Execution result
   */
  async iterate(params: IterateParams): Promise<IterationResult> {
    const { repository, branchName, prompt, requestId, maxIterations = 25, callbackUrl } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ prompt });
    if (validationError) {
      // If callback URL is provided, notify about validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            iterations: 0,
            maxIterations,
            output: '',
            error: validationError.body?.error || 'Validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for validation error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      return { ...validationError, requestId };
    }

    // Validate repository exists or use repositories directory
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      // If callback URL is provided, notify about repository validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            iterations: 0,
            maxIterations,
            output: '',
            error: repoValidation.body?.error || 'Repository validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for repository error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      const errorResponse: ErrorResponse = {
        status: repoValidation.status,
        body: repoValidation.body || {
          success: false,
          error: 'Repository validation error',
        },
        requestId,
      };
      return errorResponse;
    }
    const fullRepositoryPath = repoValidation.fullRepositoryPath;
    if (!fullRepositoryPath) {
      const errorResponse: ErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: 'Failed to determine repository path',
        },
        requestId,
      };
      return errorResponse;
    }

    // Ensure workspace trust is configured before executing commands
    await this.workspaceTrust.ensureWorkspaceTrust(fullRepositoryPath);

    // Prepare and execute initial command
    // Use longer timeout for iterate operations
    const iterateTimeout = parseInt(process.env.CURSOR_CLI_ITERATE_TIMEOUT || '900000', 10); // 15 minutes default
    // --print runs in non-interactive mode (required for automation)
    // Note: Don't use --resume for initial commands as it triggers session selection menu
    // --force enables file modifications
    const command = `--print --force "${prompt}"`;
    const modifiedArgs = this.prepareCommand(command);

    logger.info('Executing initial cursor command for iterate', {
      requestId,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
      timeout: `${iterateTimeout}ms`,
    });

    let lastResult: CommandResult;
    try {
      lastResult = await this.cursorCLI.executeCommand([...modifiedArgs], {
        cwd: fullRepositoryPath,
        timeout: iterateTimeout,
      });
    } catch (error) {
      // If command failed (e.g., timeout), extract partial output from error if available
      const commandError = isCommandError(error) ? error : (error as CommandError);
      logger.error('Initial cursor command failed', {
        requestId,
        error: commandError.message,
        hasPartialOutput: !!(commandError.stdout || commandError.stderr),
      });

      // Create a result object from the error with any partial output
      lastResult = {
        success: false,
        exitCode: commandError.exitCode || 1,
        stdout: commandError.stdout || '',
        stderr: commandError.stderr || commandError.message || '',
      };

      // If we have partial output, continue to review it; otherwise, throw to trigger error callback
      if (!commandError.stdout && !commandError.stderr) {
        throw error;
      }
    }

    let iteration = 1;
    let iterationError: string | null = null;
    let reviewJustification: string | null = null;
    let originalOutput: string | null = null;

    // Iteration loop
    while (iteration <= maxIterations) {
      logger.info('Iteration started', {
        requestId,
        iteration,
        repository,
        branchName,
      });

      // Review the output
      logger.info('Reviewing output with review agent', {
        requestId,
        iteration,
      });

      // Store the original output before review (in case we need to break)
      originalOutput = lastResult.stdout || '';

      let reviewResponse: {
        result: ReviewResult | null;
        rawOutput: string;
      };
      try {
        reviewResponse = await this.reviewAgent.reviewOutput(
          lastResult.stdout,
          fullRepositoryPath,
          iterateTimeout || null
        );
      } catch (reviewError) {
        // If review agent throws an error, construct a review result from the error
        const error = reviewError instanceof Error ? reviewError : new Error(String(reviewError));
        logger.error('Review agent threw an error', {
          requestId,
          iteration,
          error: getErrorMessage(error),
        });
        reviewResponse = {
          result: null,
          rawOutput: `Review agent execution error: ${getErrorMessage(error)}`,
        };
      }

      // If parsing failed, construct our own review result
      let reviewResult: ReviewResult | null = reviewResponse.result;
      if (!reviewResult) {
        logger.warn('Failed to parse review result, constructing fallback review result', {
          requestId,
          iteration,
          originalOutputLength: originalOutput.length,
          reviewAgentOutput: reviewResponse.rawOutput?.substring(0, 200),
        });
        // Construct a review result that breaks iteration with the review agent's output as justification
        reviewResult = {
          code_complete: false,
          break_iteration: true,
          justification:
            reviewResponse.rawOutput ||
            'Failed to parse review agent output. This may indicate an authentication error or review agent failure.',
        };
      }

      logger.info('Review result', {
        requestId,
        iteration,
        code_complete: reviewResult.code_complete,
        break_iteration: reviewResult.break_iteration,
      });

      // If break_iteration is true, throw an error to stop iterations
      if (reviewResult.break_iteration) {
        logger.error('Review agent detected permission issue, breaking iterations', {
          requestId,
          iteration,
          justification: reviewResult.justification || 'Permission issue detected',
        });
        reviewJustification =
          reviewResult.justification ||
          'Cursor is requesting permissions or indicating it lacks permissions to execute commands. This requires manual intervention.';
        iterationError = reviewJustification;
        break;
      }

      // If code is complete, break
      if (reviewResult.code_complete) {
        logger.info('Code marked as complete', { requestId, iteration });
        break;
      }

      // Prepare resume prompt
      const resumePrompt =
        'If an error or issue occurred above, please resume this solution by debugging or resolving previous issues as much as possible. Try new approaches.';

      // Execute cursor with --print (non-interactive), --resume and --force to enable actual file operations
      const resumeArgs: string[] = ['--print', '--resume', '--force', resumePrompt];
      logger.info('Executing cursor resume command', {
        requestId,
        iteration,
        command: resumeArgs,
        cwd: fullRepositoryPath,
        timeout: `${iterateTimeout}ms`,
      });

      try {
        lastResult = await this.cursorCLI.executeCommand([...resumeArgs], {
          cwd: fullRepositoryPath,
          timeout: iterateTimeout,
        });
      } catch (error) {
        // If command failed (e.g., timeout), extract partial output from error if available
        const commandError = isCommandError(error) ? error : (error as CommandError);
        logger.error('Cursor resume command failed', {
          requestId,
          iteration,
          error: commandError.message,
          hasPartialOutput: !!(commandError.stdout || commandError.stderr),
        });

        // Create a result object from the error with any partial output
        lastResult = {
          success: false,
          exitCode: commandError.exitCode || 1,
          stdout: commandError.stdout || '',
          stderr: commandError.stderr || commandError.message || '',
        };

        // If we have no partial output, throw to break iteration
        if (!commandError.stdout && !commandError.stderr) {
          throw error;
        }
      }

      iteration++;
    }

    // Format response
    const duration = Date.now() - startTime;
    // Consider it a failure if the last result failed OR if there was an iteration error
    const isSuccess = lastResult.success !== false && !iterationError;

    logger.info('Cursor iterate completed', {
      requestId,
      repository,
      branchName,
      iterations: iteration - 1,
      success: isSuccess,
      duration: `${duration}ms`,
    });

    // Combine errors: prefer iteration error if present, otherwise use lastResult error
    const errorMessage = iterationError || lastResult.stderr || null;

    // Use discriminated union - return ErrorResponse if failed, SuccessResponse if succeeded
    if (!isSuccess) {
      const errorResponseBody: CallbackWebhookPayload = {
        success: false,
        requestId,
        repository,
        error: errorMessage || 'Iteration failed',
        exitCode: lastResult.exitCode || 1,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
        iterations: iteration - 1,
        maxIterations,
        output: lastResult.stdout || '',
      };

      // Include review justification and original output if available
      if (reviewJustification) {
        errorResponseBody.reviewJustification = reviewJustification;
      }
      if (originalOutput) {
        errorResponseBody.originalOutput = originalOutput;
      }

      // If callback URL is provided, call it asynchronously (don't wait)
      if (callbackUrl) {
        this.callbackWebhook(callbackUrl, errorResponseBody, requestId).catch((error) => {
          logger.error('Failed to call callback webhook for iteration error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }

      const errorResponse: ErrorResponse = {
        status: 422,
        body: {
          success: false,
          error: errorMessage || 'Iteration failed',
        },
        requestId,
      };
      return errorResponse;
    }

    const responseBody: SuccessResponseBody = {
      success: true,
      requestId,
      repository,
      iterations: iteration - 1,
      maxIterations,
      output: lastResult.stdout || '',
      error: errorMessage,
      exitCode: lastResult.exitCode || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };

    // If there was a review agent error, include both the justification and original output
    if (reviewJustification) {
      responseBody.reviewJustification = reviewJustification;
    }

    // Always include original output when there's an iteration error (review failure, review agent error, or break_iteration)
    // This ensures the user can see what cursor produced even if the review agent fails
    if (iterationError) {
      if (originalOutput) {
        responseBody.originalOutput = originalOutput;
      } else {
        // Fallback to lastResult.stdout if originalOutput wasn't captured
        responseBody.originalOutput = lastResult.stdout || '';
      }
    }

    // Include branchName in response if provided
    if (branchName) {
      responseBody.branchName = branchName;
    }

    // If callback URL is provided, call it asynchronously (don't wait)
    if (callbackUrl) {
      this.callbackWebhook(callbackUrl, responseBody, requestId).catch((error) => {
        logger.error('Failed to call callback webhook', {
          requestId,
          callbackUrl,
          error: getErrorMessage(error),
        });
      });
    }

    // Return appropriate status code based on success
    // 422 Unprocessable Entity for failed operations (e.g., authentication errors, command failures)
    // 200 OK for successful operations
    return {
      status: isSuccess ? 200 : 422,
      body: responseBody,
    };
  }

  /**
   * Call webhook callback URL with result
   * @param callbackUrl - URL to call (may include secret in query string)
   * @param result - Result to send
   * @param requestId - Request ID for logging
   * @returns Promise that resolves when webhook is called
   */
  async callbackWebhook(
    callbackUrl: string,
    result: CallbackWebhookPayload,
    requestId: string
  ): Promise<void> {
    try {
      logger.info('Calling callback webhook', { requestId, callbackUrl });

      // Get webhook secret from environment or URL query parameter
      const url = new URL(callbackUrl);
      let secret = url.searchParams.get('secret');

      // If no secret in URL, try environment variable
      if (!secret) {
        secret = getWebhookSecret();
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'cursor-runner/1.0',
      };

      // Add secret to headers if available
      if (secret) {
        headers['X-Webhook-Secret'] = secret;
        headers['X-Cursor-Runner-Secret'] = secret; // Also support this header name for compatibility
        // Remove secret from URL for cleaner logging
        url.searchParams.delete('secret');
        callbackUrl = url.toString();
      }

      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(result),
        // Set reasonable timeout for webhook calls
        signal: AbortSignal.timeout(30000), // 30 seconds
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      logger.info('Callback webhook called successfully', {
        requestId,
        callbackUrl,
        status: response.status,
      });
    } catch (error) {
      // Log error but don't throw - we don't want to fail the main operation
      const err = error instanceof Error ? error : new Error(getErrorMessage(error));
      if (err.name === 'AbortError') {
        logger.error('Callback webhook timeout', { requestId, callbackUrl });
      } else {
        logger.error('Callback webhook error', {
          requestId,
          callbackUrl,
          error: getErrorMessage(err),
        });
      }
      throw err; // Re-throw so caller can handle if needed
    }
  }
}
