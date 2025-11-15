import path from 'path';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';

/**
 * CursorExecutionService - Orchestrates cursor command execution
 *
 * Handles repository validation, command preparation,
 * and execution coordination for both single and iterative cursor commands.
 */
export class CursorExecutionService {
  constructor(
    gitService,
    cursorCLI,
    terminalService,
    commandParser,
    reviewAgent,
    filesystem = null
  ) {
    this.gitService = gitService;
    this.cursorCLI = cursorCLI;
    this.terminalService = terminalService;
    this.commandParser = commandParser;
    this.reviewAgent = reviewAgent;
    this.filesystem = filesystem || new FilesystemService();
    this.terminalInstructions = process.env.EXECUTE_TERMINAL_COMMANDS
      ? '\n\nIf you need to run a terminal command, stop and request that the caller run the terminal command for you. Be explicit about what terminal command needs to be run.'
      : '';
  }

  /**
   * Validate execution request parameters
   * @param {Object} params - Request parameters
   * @returns {Object|null} Error response or null if valid
   */
  validateRequest(params) {
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
   * @param {string|null|undefined} repository - Repository name (optional)
   * @returns {Object|null} Error response or { fullRepositoryPath } if valid
   */
  validateRepository(repository) {
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
   * @param {string} command - Original command string
   * @returns {Array<string>} Prepared command arguments
   */
  prepareCommand(command) {
    const commandArgs = this.commandParser.parseCommand(command);
    return this.commandParser.appendInstructions(commandArgs, this.terminalInstructions);
  }

  /**
   * Execute a single cursor command
   * @param {Object} params - Execution parameters
   * @param {string} [params.repository] - Repository name (optional, uses repositories directory if not provided)
   * @param {string} [params.branchName] - Optional branch name (for logging/tracking)
   * @param {string} params.prompt - Prompt string
   * @param {string} params.requestId - Request ID
   * @param {string} [params.callbackUrl] - Optional callback URL to notify when complete
   * @returns {Promise<Object>} Execution result
   */
  async execute(params) {
    const { repository, branchName, prompt, requestId, callbackUrl } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ prompt });
    if (validationError) {
      return { ...validationError, requestId };
    }

    // Validate repository exists or use repositories directory
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

    // Construct command from prompt
    const command = `--print "${prompt}"`;

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

    const result = await this.cursorCLI.executeCommand(modifiedArgs, {
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

    const responseBody = {
      success: result.success !== false,
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
          error: error.message,
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
   * @param {Object} params - Execution parameters
   * @param {string} [params.repository] - Repository name (optional, uses repositories directory if not provided)
   * @param {string} [params.branchName] - Optional branch name (for logging/tracking)
   * @param {string} params.prompt - Prompt string
   * @param {string} params.requestId - Request ID
   * @param {number} params.maxIterations - Maximum iterations (default: 25)
   * @param {string} [params.callbackUrl] - Optional callback URL to notify when complete
   * @returns {Promise<Object>} Execution result
   */
  async iterate(params) {
    const { repository, branchName, prompt, requestId, maxIterations = 25, callbackUrl } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ prompt });
    if (validationError) {
      return { ...validationError, requestId };
    }

    // Validate repository exists or use repositories directory
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

    // Prepare and execute initial command
    // Use longer timeout for iterate operations
    const iterateTimeout = parseInt(process.env.CURSOR_CLI_ITERATE_TIMEOUT || '900000', 10); // 15 minutes default
    const command = `--print "${prompt}"`;
    const modifiedArgs = this.prepareCommand(command);

    logger.info('Executing initial cursor command for iterate', {
      requestId,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
      timeout: `${iterateTimeout}ms`,
    });

    let lastResult = await this.cursorCLI.executeCommand(modifiedArgs, {
      cwd: fullRepositoryPath,
      timeout: iterateTimeout,
    });

    let iteration = 1;
    let terminalOutput = null;
    let iterationError = null;

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

      const reviewResult = await this.reviewAgent.reviewOutput(
        lastResult.stdout,
        fullRepositoryPath,
        iterateTimeout
      );

      if (!reviewResult) {
        logger.warn('Failed to parse review result', { requestId, iteration });
        iterationError =
          'Failed to parse review agent output. This may indicate an authentication error or review agent failure.';
        break;
      }

      logger.info('Review result', {
        requestId,
        iteration,
        code_complete: reviewResult.code_complete,
        execute_terminal_command: reviewResult.execute_terminal_command,
      });

      // If terminal command is requested, execute it (even if code is marked complete,
      // as cursor might want to verify with tests, linting, etc.)
      if (reviewResult.execute_terminal_command && reviewResult.terminal_command_requested) {
        logger.info('Executing terminal command', {
          requestId,
          iteration,
          command: reviewResult.terminal_command_requested,
        });

        try {
          // Parse terminal command into command and args
          const terminalCommandParts = this.commandParser.parseCommand(
            reviewResult.terminal_command_requested
          );
          const terminalCommand = terminalCommandParts[0];
          const terminalArgs = terminalCommandParts.slice(1);

          const terminalResult = await this.terminalService.executeCommand(
            terminalCommand,
            terminalArgs,
            { cwd: fullRepositoryPath }
          );
          terminalOutput = terminalResult.stdout || terminalResult.stderr || '';
          logger.info('Terminal command executed', {
            requestId,
            iteration,
            exitCode: terminalResult.exitCode,
            success: terminalResult.success,
          });
        } catch (error) {
          logger.error('Terminal command failed', {
            requestId,
            iteration,
            error: error.message,
          });
          terminalOutput = `Error executing command: ${error.message}`;
        }
      }

      // If code is complete and no terminal command was requested, break
      // If code is complete but terminal command was executed, continue to resume
      // so cursor can see the terminal output and make final decisions
      if (reviewResult.code_complete && !reviewResult.execute_terminal_command) {
        logger.info('Code marked as complete', { requestId, iteration });
        break;
      }

      // Prepare resume prompt
      let resumePrompt =
        'If an error or issue occurred above, please resume this solution by debugging or resolving previous issues as much as possible. Try new approaches.';

      if (terminalOutput) {
        resumePrompt += `\n\nIf you requested a terminal command, here is the output from the latest terminal command:\n${terminalOutput}`;
      }

      // Execute cursor with --resume
      const resumeArgs = ['--resume', resumePrompt];
      logger.info('Executing cursor resume command', {
        requestId,
        iteration,
        command: resumeArgs,
        cwd: fullRepositoryPath,
        timeout: `${iterateTimeout}ms`,
      });

      lastResult = await this.cursorCLI.executeCommand(resumeArgs, {
        cwd: fullRepositoryPath,
        timeout: iterateTimeout,
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

    const responseBody = {
      success: isSuccess,
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
          error: error.message,
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
   * @param {string} callbackUrl - URL to call (may include secret in query string)
   * @param {Object} result - Result to send
   * @param {string} requestId - Request ID for logging
   * @returns {Promise<void>}
   */
  async callbackWebhook(callbackUrl, result, requestId) {
    try {
      logger.info('Calling callback webhook', { requestId, callbackUrl });

      // Extract secret from URL if present, and add to headers
      const url = new URL(callbackUrl);
      const secret = url.searchParams.get('secret');
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'cursor-runner/1.0',
      };
      if (secret) {
        headers['X-Webhook-Secret'] = secret;
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
      if (error.name === 'AbortError') {
        logger.error('Callback webhook timeout', { requestId, callbackUrl });
      } else {
        logger.error('Callback webhook error', {
          requestId,
          callbackUrl,
          error: error.message,
        });
      }
      throw error; // Re-throw so caller can handle if needed
    }
  }
}
