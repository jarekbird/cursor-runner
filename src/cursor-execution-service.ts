import path from 'path';
import { mkdirSync } from 'fs';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';
import { getWebhookSecret } from './callback-url-builder.js';
import { WorkspaceTrustService } from './workspace-trust-service.js';
import { getErrorMessage } from './error-utils.js';
import { ConversationService } from './conversation-service.js';
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
  conversationId?: string;
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
  conversationId?: string;
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
 * System settings MCP instructions
 * These instructions are appended to all non-review agent prompts
 */
const SCRIPTS_PATH = process.env.SCRIPTS_PATH || '/cursor/scripts';
const CURSOR_AGENTS_TOOLS_PATH =
  process.env.CURSOR_AGENTS_TOOLS_PATH || '/cursor/tools/cursor-agents';
const SYSTEM_SETTINGS_MCP_INSTRUCTIONS = `\n\nIMPORTANT: When updating system settings (SystemSetting model), you MUST use the cursor-runner-shared-sqlite MCP connection.

IMPORTANT: When working with cursor-agents (creating, listing, getting status, or deleting agents), use the Python scripts in ${CURSOR_AGENTS_TOOLS_PATH}/ directory. These scripts communicate with the cursor-agents service over HTTP:

Agent Management:
- To list all agents: python3 ${CURSOR_AGENTS_TOOLS_PATH}/list_agents.py
- To get agent status: python3 ${CURSOR_AGENTS_TOOLS_PATH}/get_agent_status.py --name <agent-name>
- To create an agent: python3 ${CURSOR_AGENTS_TOOLS_PATH}/create_agent.py --name <name> --target-url <url> [options]
  - Use --queue <queue-name> to assign the agent to a specific queue (defaults to "default" if not specified)
  - Use --schedule <cron-pattern> for recurring agents (e.g., "0 8 * * *" for daily at 8 AM)
  - Use --one-time for one-time agents that run immediately
- To delete an agent: python3 ${CURSOR_AGENTS_TOOLS_PATH}/delete_agent.py --name <agent-name>

Queue Management:
- To list all queues: python3 ${CURSOR_AGENTS_TOOLS_PATH}/list_queues.py
- To get queue info: python3 ${CURSOR_AGENTS_TOOLS_PATH}/get_queue_info.py --queue-name <queue-name>
- To delete an empty queue: python3 ${CURSOR_AGENTS_TOOLS_PATH}/delete_queue.py --queue-name <queue-name>
  - Note: Cannot delete the "default" queue or queues with active jobs

When creating an agent, the target URL should be the cursor-runner docker networked URL (http://cursor-runner:3001/cursor/iterate/async) with a prompt that this agent will later execute.

Queue Organization: Agents can be organized into queues to avoid queue bloat. By default, agents are created in the "default" queue. Use descriptive queue names like "daily-tasks", "hourly-sync", or "urgent-jobs" to group related agents together.

IMPORTANT: When creating one-time scripts (shell scripts, Python scripts, etc.), place them in ${SCRIPTS_PATH}. This directory is shared and persistent across container restarts. Do not create scripts in the repository directories or other temporary locations.`;

/**
 * CursorExecutionService - Orchestrates cursor command execution
 *
 * Handles repository validation, command preparation,
 * and execution coordination for both single and iterative cursor commands.
 */
export class CursorExecutionService {
  private gitService: GitService;
  private scriptsPath: string;
  private cursorCLI: CursorCLI;
  private commandParser: CommandParserService;
  private reviewAgent: ReviewAgentService;
  private filesystem: FilesystemService;
  private workspaceTrust: WorkspaceTrustService;
  public conversationService: ConversationService;

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
    this.conversationService = new ConversationService();
    this.scriptsPath = SCRIPTS_PATH;
    this.ensureScriptsDirectory();
  }

  /**
   * Ensure scripts directory exists
   */
  private ensureScriptsDirectory(): void {
    if (!this.filesystem.exists(this.scriptsPath)) {
      try {
        mkdirSync(this.scriptsPath, { recursive: true });
        logger.info('Created scripts directory', { path: this.scriptsPath });
      } catch (error) {
        // In test environments or when permissions are insufficient, log a warning
        // The directory will be created when the container starts with proper permissions
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Could not create scripts directory', {
          path: this.scriptsPath,
          error: errorMessage,
        });
      }
    }
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
    // Append system settings MCP instructions to all prompts
    return this.commandParser.appendInstructions(commandArgs, SYSTEM_SETTINGS_MCP_INSTRUCTIONS);
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
    const { repository, branchName, prompt, requestId, callbackUrl, conversationId } = params;
    const startTime = Date.now();

    // Get or create conversation ID (always created internally, never by external services)
    // If not provided, uses the most recently used conversation
    const convId = await this.conversationService.getConversationId(conversationId);
    logger.info('Using conversation', { conversationId: convId, requestId });

    // Get conversation context (built from all stored messages)
    const contextMessages = await this.conversationService.getConversationContext(convId);
    const contextString = this.conversationService.buildContextString(contextMessages);

    // Build prompt with context - we pass the entire context string to cursor, NOT the conversation ID
    // The conversation ID is purely an internal concept for managing context in Redis
    const promptWithContext = contextString
      ? `${contextString}\n\n[Current Request]\n${prompt}`
      : prompt;

    // Store only the individual user message (not the full context) to avoid duplication
    await this.conversationService.addMessage(convId, 'user', prompt, false);

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
    // Note: We don't use --resume - we maintain conversation context ourselves
    // --force enables file modifications
    const command = `--print --force "${promptWithContext}"`;

    // Prepare command
    let modifiedArgs = [...this.prepareCommand(command)];

    // Execute cursor command
    logger.info('Executing cursor command', {
      requestId,
      repository,
      branchName,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
    });

    let result: CommandResult | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      try {
        result = await this.cursorCLI.executeCommand([...modifiedArgs], {
          cwd: fullRepositoryPath,
        });

        // Check for context window errors
        const output = result.stdout + result.stderr;
        if (this.conversationService.isContextWindowError(output)) {
          logger.warn('Context window error detected, summarizing conversation', {
            conversationId: convId,
            requestId,
            retryCount,
          });

          // Summarize conversation
          await this.summarizeConversation(convId);

          // Rebuild prompt with summarized context
          const summarizedContext = await this.conversationService.getConversationContext(convId);
          const summarizedContextString =
            this.conversationService.buildContextString(summarizedContext);
          const newPromptWithContext = summarizedContextString
            ? `${summarizedContextString}\n\n[Current Request]\n${prompt}`
            : prompt;

          // Update command with summarized context
          const newCommand = `--print --force "${newPromptWithContext}"`;
          modifiedArgs = [...this.prepareCommand(newCommand)];

          retryCount++;
          if (retryCount > maxRetries) {
            logger.error('Max retries exceeded for context window errors', {
              conversationId: convId,
              requestId,
            });
            break;
          }
          continue;
        }

        // Success - store only the individual assistant response (not the full context)
        await this.conversationService.addMessage(
          convId,
          'assistant',
          result.stdout || result.stderr || '',
          false
        );
        break;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const commandError = isCommandError(error) ? error : (error as CommandError);
        const errorOutput = commandError.stdout || errorMessage;

        // Check if it's a context window error
        if (this.conversationService.isContextWindowError(errorOutput)) {
          logger.warn('Context window error in exception, summarizing conversation', {
            conversationId: convId,
            requestId,
            retryCount,
          });

          await this.summarizeConversation(convId);

          // Rebuild prompt with summarized context
          const summarizedContext = await this.conversationService.getConversationContext(convId);
          const summarizedContextString =
            this.conversationService.buildContextString(summarizedContext);
          const newPromptWithContext = summarizedContextString
            ? `${summarizedContextString}\n\n[Current Request]\n${prompt}`
            : prompt;

          const newCommand = `--print --force "${newPromptWithContext}"`;
          modifiedArgs = [...this.prepareCommand(newCommand)];

          retryCount++;
          if (retryCount > maxRetries) {
            throw error;
          }
          continue;
        }

        throw error;
      }
    }

    if (!result) {
      throw new Error('Failed to execute cursor command after retries');
    }

    const duration = Date.now() - startTime;
    logger.info('Cursor execution completed', {
      requestId,
      repository,
      branchName,
      success: result.success,
      duration: `${duration}ms`,
      conversationId: convId,
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
    const {
      repository,
      branchName,
      prompt,
      requestId,
      maxIterations = 25,
      callbackUrl,
      conversationId,
    } = params;
    const startTime = Date.now();

    // Get or create conversation ID
    const convId = await this.conversationService.getConversationId(conversationId);
    logger.info('Using conversation for iterate', { conversationId: convId, requestId });

    // Get conversation context
    const contextMessages = await this.conversationService.getConversationContext(convId);
    const contextString = this.conversationService.buildContextString(contextMessages);

    // Build prompt with context
    const promptWithContext = contextString
      ? `${contextString}\n\n[Current Request]\n${prompt}`
      : prompt;

    // Store user message in conversation
    await this.conversationService.addMessage(convId, 'user', prompt, false);

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
    // Note: We don't use --resume - we maintain conversation context ourselves
    // --force enables file modifications
    const command = `--print --force "${promptWithContext}"`;
    const modifiedArgs = this.prepareCommand(command);

    logger.info('Executing initial cursor command for iterate', {
      requestId,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
      timeout: `${iterateTimeout}ms`,
    });

    let lastResult: CommandResult | null = null;
    let retryCount = 0;
    const maxRetries = 3;
    let currentPrompt = promptWithContext;
    let currentArgs = [...modifiedArgs];

    while (retryCount <= maxRetries) {
      try {
        lastResult = await this.cursorCLI.executeCommand([...currentArgs], {
          cwd: fullRepositoryPath,
          timeout: iterateTimeout,
        });

        // Check for context window errors
        const output = lastResult.stdout + lastResult.stderr;
        if (this.conversationService.isContextWindowError(output)) {
          logger.warn(
            'Context window error detected in initial command, summarizing conversation',
            {
              conversationId: convId,
              requestId,
              retryCount,
            }
          );

          await this.summarizeConversation(convId);

          // Rebuild prompt with summarized context
          const summarizedContext = await this.conversationService.getConversationContext(convId);
          const summarizedContextString =
            this.conversationService.buildContextString(summarizedContext);
          currentPrompt = summarizedContextString
            ? `${summarizedContextString}\n\n[Current Request]\n${prompt}`
            : prompt;

          const newCommand = `--print --force "${currentPrompt}"`;
          currentArgs = [...this.prepareCommand(newCommand)];

          retryCount++;
          if (retryCount > maxRetries) {
            logger.error('Max retries exceeded for context window errors in initial command', {
              conversationId: convId,
              requestId,
            });
            break;
          }
          continue;
        }

        // Success - store assistant response
        await this.conversationService.addMessage(
          convId,
          'assistant',
          lastResult.stdout || lastResult.stderr || '',
          false
        );
        break;
      } catch (error) {
        // If command failed (e.g., timeout), extract partial output from error if available
        const commandError = isCommandError(error) ? error : (error as CommandError);

        // Check if it's a context window error
        const errorOutput =
          commandError.stdout || commandError.stderr || commandError.message || '';
        if (this.conversationService.isContextWindowError(errorOutput)) {
          logger.warn('Context window error in exception, summarizing conversation', {
            conversationId: convId,
            requestId,
            retryCount,
          });

          await this.summarizeConversation(convId);

          // Rebuild prompt with summarized context
          const summarizedContext = await this.conversationService.getConversationContext(convId);
          const summarizedContextString =
            this.conversationService.buildContextString(summarizedContext);
          currentPrompt = summarizedContextString
            ? `${summarizedContextString}\n\n[Current Request]\n${prompt}`
            : prompt;

          const newCommand = `--print --force "${currentPrompt}"`;
          currentArgs = [...this.prepareCommand(newCommand)];

          retryCount++;
          if (retryCount > maxRetries) {
            // If we have partial output, continue to review it; otherwise, throw to trigger error callback
            if (!commandError.stdout && !commandError.stderr) {
              throw error;
            }
            break;
          }
          continue;
        }

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
        break;
      }
    }

    if (!lastResult) {
      throw new Error('Failed to execute initial cursor command after retries');
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

      // Store assistant response in conversation (before review agent processes it)
      // This ensures we capture the cursor output, but review agent interactions are excluded
      await this.conversationService.addMessage(
        convId,
        'assistant',
        lastResult.stdout || lastResult.stderr || '',
        false
      );

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

        // Check if the command succeeded - if so, infer completion to prevent infinite loops
        const commandSucceeded =
          lastResult.success !== false &&
          (lastResult.exitCode === 0 || lastResult.exitCode === null) &&
          !lastResult.stderr &&
          originalOutput.length > 0;

        if (commandSucceeded) {
          logger.info('Review agent failed to parse but command succeeded, inferring completion', {
            requestId,
            iteration,
          });
          reviewResult = {
            code_complete: true,
            break_iteration: false,
            justification:
              'Review agent failed to parse, but cursor command succeeded. Task marked as complete to prevent infinite loops.',
          };
        } else {
          // Construct a review result that breaks iteration with the review agent's output as justification
          reviewResult = {
            code_complete: false,
            break_iteration: true,
            justification:
              reviewResponse.rawOutput ||
              'Failed to parse review agent output. This may indicate an authentication error or review agent failure.',
          };
        }
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

      // Get current conversation context for resume
      const resumeContextMessages = await this.conversationService.getConversationContext(convId);
      const resumeContextString =
        this.conversationService.buildContextString(resumeContextMessages);

      // Build resume prompt with context
      const resumePromptWithContext = resumeContextString
        ? `${resumeContextString}\n\n[Continue/Resume]\n${resumePrompt}`
        : resumePrompt;

      // Append system settings MCP instructions to resume prompt
      const resumePromptWithInstructions =
        resumePromptWithContext + SYSTEM_SETTINGS_MCP_INSTRUCTIONS;

      // Store user message (resume request) in conversation
      await this.conversationService.addMessage(convId, 'user', resumePrompt, false);

      // Execute cursor with --print (non-interactive) and --force to enable actual file operations
      // Note: We don't use --resume - we maintain conversation context ourselves
      const resumeArgs: string[] = ['--print', '--force', resumePromptWithInstructions];
      logger.info('Executing cursor resume command', {
        requestId,
        iteration,
        command: resumeArgs,
        cwd: fullRepositoryPath,
        timeout: `${iterateTimeout}ms`,
      });

      let resumeRetryCount = 0;
      const maxResumeRetries = 3;
      let currentResumePrompt = resumePromptWithInstructions;
      let currentResumeArgs = [...resumeArgs];

      while (resumeRetryCount <= maxResumeRetries) {
        try {
          lastResult = await this.cursorCLI.executeCommand([...currentResumeArgs], {
            cwd: fullRepositoryPath,
            timeout: iterateTimeout,
          });

          // Check for context window errors
          const output = lastResult.stdout + lastResult.stderr;
          if (this.conversationService.isContextWindowError(output)) {
            logger.warn(
              'Context window error detected in resume command, summarizing conversation',
              {
                conversationId: convId,
                requestId,
                iteration,
                retryCount: resumeRetryCount,
              }
            );

            await this.summarizeConversation(convId);

            // Rebuild resume prompt with summarized context
            const summarizedContext = await this.conversationService.getConversationContext(convId);
            const summarizedContextString =
              this.conversationService.buildContextString(summarizedContext);
            currentResumePrompt = summarizedContextString
              ? `${summarizedContextString}\n\n[Continue/Resume]\n${resumePrompt}${SYSTEM_SETTINGS_MCP_INSTRUCTIONS}`
              : resumePrompt + SYSTEM_SETTINGS_MCP_INSTRUCTIONS;

            currentResumeArgs = ['--print', '--force', currentResumePrompt];

            resumeRetryCount++;
            if (resumeRetryCount > maxResumeRetries) {
              logger.error('Max retries exceeded for context window errors in resume command', {
                conversationId: convId,
                requestId,
                iteration,
              });
              break;
            }
            continue;
          }

          // Success - store assistant response
          await this.conversationService.addMessage(
            convId,
            'assistant',
            lastResult.stdout || lastResult.stderr || '',
            false
          );
          break;
        } catch (error) {
          // If command failed (e.g., timeout), extract partial output from error if available
          const commandError = isCommandError(error) ? error : (error as CommandError);

          // Check if it's a context window error
          const errorOutput =
            commandError.stdout || commandError.stderr || commandError.message || '';
          if (this.conversationService.isContextWindowError(errorOutput)) {
            logger.warn('Context window error in resume exception, summarizing conversation', {
              conversationId: convId,
              requestId,
              iteration,
              retryCount: resumeRetryCount,
            });

            await this.summarizeConversation(convId);

            // Rebuild resume prompt with summarized context
            const summarizedContext = await this.conversationService.getConversationContext(convId);
            const summarizedContextString =
              this.conversationService.buildContextString(summarizedContext);
            currentResumePrompt = summarizedContextString
              ? `${summarizedContextString}\n\n[Continue/Resume]\n${resumePrompt}${SYSTEM_SETTINGS_MCP_INSTRUCTIONS}`
              : resumePrompt + SYSTEM_SETTINGS_MCP_INSTRUCTIONS;

            currentResumeArgs = ['--print', '--force', currentResumePrompt];

            resumeRetryCount++;
            if (resumeRetryCount > maxResumeRetries) {
              // If we have partial output, continue to review it; otherwise, throw to break iteration
              if (!commandError.stdout && !commandError.stderr) {
                throw error;
              }
              break;
            }
            continue;
          }

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
          break;
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
   * Summarize conversation using cursor when context window is too large
   */
  private async summarizeConversation(conversationId: string): Promise<void> {
    const messages = await this.conversationService.getRawConversation(conversationId);

    if (messages.length === 0) {
      return;
    }

    // Build context string for summarization
    const contextString = this.conversationService.buildContextString(messages);

    // Create summarization prompt
    const summarizePrompt = `Please summarize the following conversation history, reducing it to approximately 1/3 of its original length while preserving all important information, decisions, and context:

${contextString}

Provide a concise summary that maintains the key points and context.`;

    try {
      // Use cursor to summarize (without storing this interaction in conversation)
      const summaryResult = await this.cursorCLI.executeCommand(
        ['--print', '--force', summarizePrompt],
        { cwd: '/tmp' } // Use temp directory for summarization
      );

      const summary = summaryResult.stdout || summaryResult.stderr || '';

      // Store the summary using the conversation service's summarize method
      await this.conversationService.summarizeConversation(conversationId, async () => summary);
    } catch (error) {
      logger.error('Failed to summarize conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      // If summarization fails, we'll just continue with the original context
      // The next attempt might work or we'll hit max retries
    }
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
