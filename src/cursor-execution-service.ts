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
import type { ReviewAgentService, ReviewOutputResult } from './review-agent-service.js';

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
  continuationPrompt?: string;
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
const SYSTEM_SETTINGS_MCP_INSTRUCTIONS = `\n\nIMPORTANT: Before beginning any prompt, you MUST clear all git changes (staged and unstaged) in the repository. Use \`git reset --hard HEAD\` to discard all local changes and \`git clean -fd\` to remove untracked files. This ensures a clean working state before starting any task.

IMPORTANT: If you push any code to origin during this task, you MUST explicitly report this in your output. State clearly: "Code pushed to origin" or "No code pushed to origin" at the end of your response. This information is critical for task completion tracking.

IMPORTANT: When updating system settings (SystemSetting model), you MUST use the cursor-runner-shared-sqlite MCP connection.

IMPORTANT: When working with tasks (creating, querying, updating, or deleting tasks), you MUST use the cursor-runner-shared-sqlite MCP connection. The tasks table is in the shared SQLite database at /app/shared_db/shared.sqlite3.

IMPORTANT: When working with conversation history in Redis (clearing, querying, or managing conversations), you MUST use the cursor-runner-shared-redis MCP connection. Conversation history is stored in Redis with keys like:
- cursor:conversation:{conversationId} - Individual conversation data
- cursor:last_conversation_id - Last conversation ID
To clear all conversation history, use Redis commands to delete keys matching the pattern cursor:conversation:* and cursor:last_conversation_id.

Tasks Table Schema:
- id: INTEGER PRIMARY KEY AUTOINCREMENT
- prompt: TEXT NOT NULL (the task prompt/description to be executed)
- status: INTEGER NOT NULL DEFAULT 0 (task status enum: 0=ready, 1=complete, 2=archived, 3=backlogged, 4=in_progress)
- createdat: DATETIME DEFAULT CURRENT_TIMESTAMP
- updatedat: DATETIME DEFAULT CURRENT_TIMESTAMP
- order: INTEGER DEFAULT 0 (lower numbers are processed first)
- uuid: TEXT (unique identifier, indexed)

Task Status Values:
- 0 = ready (ready to be processed by task operator)
- 1 = complete (task has been completed)
- 2 = archived (task has been archived)
- 3 = backlogged (task is in backlog, not ready for processing)
- 4 = in_progress (task is currently being processed)

Task Management Examples:
- To create a ready task: INSERT INTO tasks (prompt, "order", status) VALUES ('your prompt here', 0, 0)
- To list ready tasks: SELECT * FROM tasks WHERE status = 0 ORDER BY "order" ASC, id ASC
- To mark a task as complete: UPDATE tasks SET status = 1, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To archive a task: UPDATE tasks SET status = 2, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To backlog a task: UPDATE tasks SET status = 3, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To get next ready task: SELECT * FROM tasks WHERE status = 0 ORDER BY "order" ASC, id ASC LIMIT 1

The task operator agent (when enabled) automatically processes tasks with status = 0 (ready), sending the prompt to cursor-runner for execution.

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
   * Check for API key errors in cursor-cli output and log prominently
   * @param output - Combined stdout/stderr output from cursor-cli
   * @param requestId - Request ID for logging context
   */
  private checkForApiKeyErrors(output: string, requestId: string): void {
    const apiKeyErrorPatterns = [
      /API key.*invalid/i,
      /invalid.*API key/i,
      /API key.*is invalid/i,
      /The provided API key is invalid/i,
    ];

    const hasApiKeyError = apiKeyErrorPatterns.some((pattern) => pattern.test(output));

    if (hasApiKeyError) {
      logger.error('Cursor API key error detected', {
        requestId,
        message:
          'CURSOR_API_KEY environment variable is invalid or not set. Please set a valid CURSOR_API_KEY in your environment configuration.',
        hint: 'Check your docker-compose.yml or .env file for CURSOR_API_KEY configuration',
      });
    }
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
   * Prepare command arguments array with instructions
   * @param args - Command arguments array
   * @returns Prepared command arguments with instructions appended
   */
  prepareCommandArgs(args: readonly string[]): readonly string[] {
    // Append system settings MCP instructions to all prompts
    return this.commandParser.appendInstructions(args, SYSTEM_SETTINGS_MCP_INSTRUCTIONS);
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

    // Get or create conversation ID (uses last conversation if none provided, creates new if none exists)
    const actualConversationId = await this.conversationService.getConversationId(conversationId);

    // Get conversation context and build context string
    const conversationMessages =
      await this.conversationService.getConversationContext(actualConversationId);
    const contextString = this.conversationService.buildContextString(conversationMessages);

    // Build prompt with conversation context prepended
    let fullPrompt = prompt;
    if (contextString) {
      fullPrompt = `${contextString}\n\n[Current Request]: ${prompt}`;
    }

    // Construct command as array to avoid parsing issues with newlines in prompt
    // --model auto uses automatic model selection (put first)
    // --print runs in non-interactive mode (required for automation)
    // --force enables file modifications
    const commandArgs = ['--model', 'auto', '--print', '--force', fullPrompt];

    // Prepare command with instructions
    const modifiedArgs = this.prepareCommandArgs(commandArgs);

    // Execute cursor command
    logger.info('Executing cursor command', {
      requestId,
      repository,
      branchName,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
    });

    // Store what we're sending to cursor in Redis (right before sending)
    await this.conversationService.addMessage(actualConversationId, 'user', fullPrompt, false);

    const result = await this.cursorCLI.executeCommand([...modifiedArgs], {
      cwd: fullRepositoryPath,
    });

    // Store what we received from cursor in Redis (right after receiving)
    const assistantOutput = result.stdout || result.stderr || '';
    if (assistantOutput) {
      await this.conversationService.addMessage(
        actualConversationId,
        'assistant',
        assistantOutput,
        false
      );
    }

    // Check for context window errors and summarize if needed
    const combinedOutput = (result.stdout || '') + (result.stderr || '');
    if (this.conversationService.isContextWindowError(combinedOutput)) {
      logger.warn('Context window error detected, summarizing conversation', {
        requestId,
        conversationId: actualConversationId,
      });
      await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
    }

    // Check for API key errors and log prominently
    this.checkForApiKeyErrors(combinedOutput, requestId);

    const duration = Date.now() - startTime;
    logger.info('Cursor execution completed', {
      requestId,
      repository,
      branchName,
      conversationId: actualConversationId,
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
   * @param params.maxIterations - Maximum iterations (default: 5)
   * @param params.callbackUrl - Optional callback URL to notify when complete
   * @returns Execution result
   */
  async iterate(params: IterateParams): Promise<IterationResult> {
    const {
      repository,
      branchName,
      prompt,
      requestId,
      maxIterations = 5,
      callbackUrl,
      conversationId,
    } = params;
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

    // Get or create conversation ID (uses last conversation if none provided, creates new if none exists)
    const actualConversationId = await this.conversationService.getConversationId(conversationId);

    // Get conversation context and build context string
    const initialConversationMessages =
      await this.conversationService.getConversationContext(actualConversationId);
    const initialContextString = this.conversationService.buildContextString(
      initialConversationMessages
    );

    // Build initial prompt with conversation context prepended
    let initialFullPrompt = prompt;
    if (initialContextString) {
      initialFullPrompt = `${initialContextString}\n\n[Current Request]: ${prompt}`;
    }

    // Prepare and execute initial command
    // Use longer timeout for iterate operations
    const iterateTimeoutValue = parseInt(process.env.CURSOR_CLI_ITERATE_TIMEOUT || '900000', 10);
    const iterateTimeout =
      isNaN(iterateTimeoutValue) || iterateTimeoutValue <= 0 ? 900000 : iterateTimeoutValue; // 15 minutes default
    // --model auto uses automatic model selection (put first)
    // --print runs in non-interactive mode (required for automation)
    // --force enables file modifications
    const commandArgs = ['--model', 'auto', '--print', '--force', initialFullPrompt];
    const modifiedArgs = this.prepareCommandArgs(commandArgs);

    logger.info('Executing initial cursor command for iterate', {
      requestId,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
      conversationId: actualConversationId,
      timeout: `${iterateTimeout}ms`,
    });

    // Store what we're sending to cursor in Redis (right before sending)
    // Only store the current request, not the full context (which is built dynamically)
    await this.conversationService.addMessage(actualConversationId, 'user', prompt, false);

    let lastResult: CommandResult;
    try {
      lastResult = await this.cursorCLI.executeCommand([...modifiedArgs], {
        cwd: fullRepositoryPath,
        timeout: iterateTimeout,
      });

      // Store what we received from cursor in Redis (right after receiving)
      const assistantOutput = lastResult.stdout || lastResult.stderr || '';
      if (assistantOutput) {
        await this.conversationService.addMessage(
          actualConversationId,
          'assistant',
          assistantOutput,
          false
        );
      }

      // Check for context window errors and summarize if needed
      const combinedOutput = (lastResult.stdout || '') + (lastResult.stderr || '');
      if (this.conversationService.isContextWindowError(combinedOutput)) {
        logger.warn('Context window error detected, summarizing conversation', {
          requestId,
          conversationId: actualConversationId,
        });
        await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
      }

      // Check for API key errors and log prominently
      this.checkForApiKeyErrors(combinedOutput, requestId);
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

      // Store partial output in conversation if available
      const partialOutput = commandError.stdout || commandError.stderr || '';
      if (partialOutput) {
        await this.conversationService.addMessage(
          actualConversationId,
          'assistant',
          partialOutput,
          false
        );
      }

      // Check for context window errors even in error case
      const combinedErrorOutput = (commandError.stdout || '') + (commandError.stderr || '');
      if (this.conversationService.isContextWindowError(combinedErrorOutput)) {
        logger.warn('Context window error detected in error output, summarizing conversation', {
          requestId,
          conversationId: actualConversationId,
        });
        await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
      }

      // Check for API key errors in error output
      this.checkForApiKeyErrors(combinedErrorOutput, requestId);

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
      // Log memory usage at start of iteration (especially for iteration 16)
      const used = process.memoryUsage();
      logger.info('Iteration started', {
        requestId,
        iteration,
        repository,
        branchName,
        memory: {
          rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(used.external / 1024 / 1024)}MB`,
        },
        uptime: process.uptime(),
      });

      // Review the output
      logger.info('Reviewing output with review agent', {
        requestId,
        iteration,
      });

      // Store the original output before review (in case we need to break)
      originalOutput = lastResult.stdout || '';

      let reviewResponse: ReviewOutputResult;
      try {
        reviewResponse = await this.reviewAgent.reviewOutput(
          lastResult.stdout,
          fullRepositoryPath,
          iterateTimeout || null,
          {
            taskPrompt: prompt,
            branchName,
          }
        );
      } catch (reviewError) {
        // If review agent throws an error, construct a review result from the error
        // When review agent throws but command succeeded, infer completion to prevent infinite loops
        const error = reviewError instanceof Error ? reviewError : new Error(String(reviewError));
        logger.error('Review agent threw an error', {
          requestId,
          iteration,
          error: getErrorMessage(error),
        });
        reviewResponse = {
          result: {
            code_complete: true,
            break_iteration: false,
            justification: `Review agent error: ${getErrorMessage(error)}. Inferring completion to prevent infinite loops.`,
          },
          rawOutput: `Review agent execution error: ${getErrorMessage(error)}`,
          prompt: undefined, // No prompt available on error
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
        // When review agent fails to parse but command succeeded, infer completion to prevent infinite loops
        // This is safer than breaking iteration, as we can't determine if work is actually complete
        reviewResult = {
          code_complete: true,
          break_iteration: false,
          justification:
            reviewResponse.rawOutput ||
            'Failed to parse review agent output. Inferring completion to prevent infinite loops.',
        };
      }

      // Always store the review agent's JSON output in conversation history
      const reviewAgentOutput = JSON.stringify({
        code_complete: reviewResult.code_complete,
        break_iteration: reviewResult.break_iteration,
        justification: reviewResult.justification || '',
      });
      await this.conversationService.addMessage(
        actualConversationId,
        'assistant',
        `[Review Agent Response] ${reviewAgentOutput}`,
        false
      );

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

      // Get updated conversation context (includes previous messages)
      const conversationMessages =
        await this.conversationService.getConversationContext(actualConversationId);
      const contextString = this.conversationService.buildContextString(conversationMessages);

      // Use continuation prompt from review agent if available, otherwise use default resume prompt
      const continuationPrompt = reviewResult.continuationPrompt;
      const resumePrompt = continuationPrompt
        ? continuationPrompt
        : 'If an error or issue occurred above, please resume this solution by debugging or resolving previous issues as much as possible. Try new approaches.';

      if (continuationPrompt) {
        logger.info('Using continuation prompt from review agent', {
          requestId,
          iteration,
          promptPreview: continuationPrompt.substring(0, 200),
        });
      }

      // Store the continuation/resume prompt in conversation history as a user message
      // This ensures the review agent's guidance is recorded in the conversation
      // This is what we actually send to the worker agent, so it should always be stored
      await this.conversationService.addMessage(actualConversationId, 'user', resumePrompt, false);

      // Build full prompt with conversation context
      // System settings MCP instructions will be appended by prepareCommandArgs
      let fullResumePrompt = resumePrompt;
      if (contextString) {
        fullResumePrompt = `${contextString}\n\n[Current Request]: ${resumePrompt}`;
      }

      // Execute cursor with --model auto first, then --print (non-interactive) and --force
      // Never use --resume, instead pass full conversation context
      const resumeCommandArgs = ['--model', 'auto', '--print', '--force', fullResumePrompt];
      const resumeArgs = this.prepareCommandArgs(resumeCommandArgs);
      logger.info('Executing cursor resume command', {
        requestId,
        iteration,
        conversationId: actualConversationId,
        command: resumeArgs,
        cwd: fullRepositoryPath,
        timeout: `${iterateTimeout}ms`,
      });

      try {
        // Note: resumePrompt was already stored at line 945, so we don't store it again here
        // The actual prompt sent to cursor is fullResumePrompt (with context), but we only
        // store the new prompt content (resumePrompt) to avoid duplicating context

        lastResult = await this.cursorCLI.executeCommand([...resumeArgs], {
          cwd: fullRepositoryPath,
          timeout: iterateTimeout,
        });

        // Store what we received from cursor in Redis (right after receiving)
        const resumeAssistantOutput = lastResult.stdout || lastResult.stderr || '';
        if (resumeAssistantOutput) {
          await this.conversationService.addMessage(
            actualConversationId,
            'assistant',
            resumeAssistantOutput,
            false
          );
        }

        // Check for context window errors and summarize if needed
        const combinedOutput = (lastResult.stdout || '') + (lastResult.stderr || '');
        if (this.conversationService.isContextWindowError(combinedOutput)) {
          logger.warn('Context window error detected in iteration, summarizing conversation', {
            requestId,
            iteration,
            conversationId: actualConversationId,
          });
          await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
        }
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

        // Store partial output in conversation if available
        const partialOutput = commandError.stdout || commandError.stderr || '';
        if (partialOutput) {
          await this.conversationService.addMessage(
            actualConversationId,
            'assistant',
            partialOutput,
            false
          );
        }

        // Check for context window errors even in error case
        const combinedErrorOutput = (commandError.stdout || '') + (commandError.stderr || '');
        if (this.conversationService.isContextWindowError(combinedErrorOutput)) {
          logger.warn('Context window error detected in error output, summarizing conversation', {
            requestId,
            iteration,
            conversationId: actualConversationId,
          });
          await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
        }

        // If we have no partial output, throw to break iteration
        if (!commandError.stdout && !commandError.stderr) {
          throw error;
        }
      }

      // Log memory usage at end of iteration (especially for iteration 16)
      const usedAfter = process.memoryUsage();
      logger.info('Iteration completed', {
        requestId,
        iteration,
        memory: {
          rss: `${Math.round(usedAfter.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(usedAfter.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(usedAfter.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(usedAfter.external / 1024 / 1024)}MB`,
        },
        uptime: process.uptime(),
      });

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

      // Store the final output in conversation history (even on error, there may be useful output)
      const finalOutput = lastResult.stdout || lastResult.stderr || '';
      if (finalOutput) {
        await this.conversationService.addMessage(
          actualConversationId,
          'assistant',
          finalOutput,
          false
        );
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

    // Store the final output in conversation history
    const finalOutput = lastResult.stdout || lastResult.stderr || '';
    if (finalOutput) {
      await this.conversationService.addMessage(
        actualConversationId,
        'assistant',
        finalOutput,
        false
      );
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
   * Summarize conversation using cursor when context window errors occur
   * Summarizes to approximately 1/3 of the original token count
   * @param conversationId - Conversation ID to summarize
   * @param cwd - Working directory for cursor execution
   */
  private async summarizeConversationIfNeeded(conversationId: string, cwd: string): Promise<void> {
    try {
      // Get raw conversation messages
      const messages = await this.conversationService.getRawConversation(conversationId);
      if (messages.length === 0) {
        logger.info('No messages to summarize', { conversationId });
        return;
      }

      // Build context string from messages
      const contextString = this.conversationService.buildContextString(messages);

      // Create summarization prompt - ask cursor to summarize to 1/3 the size
      const summarizePrompt = `Please summarize the following conversation history, reducing it to approximately 1/3 of its current size while preserving all critical information, decisions, and context needed for continuation. Focus on key decisions, important details, and maintain the essential context.

Conversation history to summarize:
${contextString}

Provide a concise summary that captures the essential information:`;

      // Use cursor to generate the summary
      const summarizeCommandArgs = ['--model', 'auto', '--print', '--force', summarizePrompt];
      const summarizeArgs = this.prepareCommandArgs(summarizeCommandArgs);

      logger.info('Summarizing conversation using cursor', {
        conversationId,
        messageCount: messages.length,
      });

      const summaryResult = await this.cursorCLI.executeCommand([...summarizeArgs], {
        cwd,
        timeout: 300000, // 5 minutes for summarization
      });

      const summary = summaryResult.stdout || summaryResult.stderr || '';
      if (!summary) {
        logger.warn('Empty summary received from cursor', { conversationId });
        return;
      }

      // Use the conversation service's summarize method with a function that returns our summary
      await this.conversationService.summarizeConversation(conversationId, async () => {
        return summary;
      });

      logger.info('Conversation summarized successfully', {
        conversationId,
        originalMessageCount: messages.length,
        summaryLength: summary.length,
      });
    } catch (error) {
      logger.error('Failed to summarize conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      // Don't throw - we don't want summarization failures to break execution
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
