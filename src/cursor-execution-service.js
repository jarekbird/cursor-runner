import path from 'path';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';
import { getWebhookSecret } from './callback-url-builder.js';
import { WorkspaceTrustService } from './workspace-trust-service.js';

/**
 * CursorExecutionService - Orchestrates cursor command execution
 *
 * Handles repository validation, command preparation,
 * and execution coordination for both single and iterative cursor commands.
 */
export class CursorExecutionService {
  constructor(gitService, cursorCLI, commandParser, reviewAgent, filesystem = null) {
    this.gitService = gitService;
    this.cursorCLI = cursorCLI;
    this.commandParser = commandParser;
    this.reviewAgent = reviewAgent;
    this.filesystem = filesystem || new FilesystemService();
    this.workspaceTrust = new WorkspaceTrustService(this.filesystem);
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
    return commandArgs;
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
            error: error.message,
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
            error: error.message,
          });
        });
      }
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

    // Ensure workspace trust is configured before executing commands
    await this.workspaceTrust.ensureWorkspaceTrust(fullRepositoryPath);

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
            error: error.message,
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
            error: error.message,
          });
        });
      }
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

    // Ensure workspace trust is configured before executing commands
    await this.workspaceTrust.ensureWorkspaceTrust(fullRepositoryPath);

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
    let iterationError = null;
    let reviewJustification = null;
    let originalOutput = null;

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

    // If there was a review agent error, include both the justification and original output
    if (reviewJustification) {
      responseBody.reviewJustification = reviewJustification;
    }

    // Include original output whenever there's an iteration error (review failure or break_iteration)
    if (iterationError && originalOutput) {
      responseBody.originalOutput = originalOutput;
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

      // Get webhook secret from environment or URL query parameter
      const url = new URL(callbackUrl);
      let secret = url.searchParams.get('secret');

      // If no secret in URL, try environment variable
      if (!secret) {
        secret = getWebhookSecret();
      }

      const headers = {
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
