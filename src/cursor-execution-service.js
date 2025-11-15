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
    this.terminalInstructions =
      '\n\nIf you need to run a terminal command, stop and request that the caller run the terminal command for you. Be explicit about what terminal command needs to be run.';
  }

  /**
   * Validate execution request parameters
   * @param {Object} params - Request parameters
   * @returns {Object|null} Error response or null if valid
   */
  validateRequest(params) {
    const { repository, command } = params;

    if (!repository) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'repository is required',
        },
      };
    }

    if (!command) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'command is required',
        },
      };
    }

    return null;
  }

  /**
   * Validate repository exists locally
   * @param {string} repository - Repository name
   * @returns {Object|null} Error response or null if valid
   */
  validateRepository(repository) {
    const repositoryPath = this.gitService.repositoriesPath;
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
   * @param {string} params.repository - Repository name
   * @param {string} [params.branchName] - Optional branch name (for logging/tracking)
   * @param {string} params.command - Command string
   * @param {string} params.requestId - Request ID
   * @returns {Promise<Object>} Execution result
   */
  async execute(params) {
    const { repository, branchName, command, requestId } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ repository, command });
    if (validationError) {
      logger.error('Cursor execution request validation failed', {
        requestId,
        error: validationError.body.error,
        status: validationError.status,
        repository,
        command,
      });
      return { ...validationError, requestId };
    }

    // Validate repository exists
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      logger.error('Cursor execution repository validation failed', {
        requestId,
        error: repoValidation.body.error,
        status: repoValidation.status,
        repository,
      });
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

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

    return {
      status: 200,
      body: responseBody,
    };
  }

  /**
   * Execute cursor command iteratively until completion
   * @param {Object} params - Execution parameters
   * @param {string} params.repository - Repository name
   * @param {string} [params.branchName] - Optional branch name (for logging/tracking)
   * @param {string} params.command - Command string
   * @param {string} params.requestId - Request ID
   * @param {number} params.maxIterations - Maximum iterations (default: 25)
   * @returns {Promise<Object>} Execution result
   */
  async iterate(params) {
    const { repository, branchName, command, requestId, maxIterations = 25 } = params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ repository, command });
    if (validationError) {
      logger.error('Cursor iterate request validation failed', {
        requestId,
        error: validationError.body.error,
        status: validationError.status,
        repository,
        command,
      });
      return { ...validationError, requestId };
    }

    // Validate repository exists
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      logger.error('Cursor iterate repository validation failed', {
        requestId,
        error: repoValidation.body.error,
        status: repoValidation.status,
        repository,
      });
      return { ...repoValidation, requestId };
    }
    const { fullRepositoryPath } = repoValidation;

    // Prepare and execute initial command
    const modifiedArgs = this.prepareCommand(command);
    let lastResult = await this.cursorCLI.executeCommand(modifiedArgs, {
      cwd: fullRepositoryPath,
    });

    let iteration = 1;
    let terminalOutput = null;

    // Iteration loop
    while (iteration <= maxIterations) {
      logger.info('Iteration started', {
        requestId,
        iteration,
        repository,
        branchName,
      });

      // Review the output
      const reviewResult = await this.reviewAgent.reviewOutput(
        lastResult.stdout,
        fullRepositoryPath
      );

      if (!reviewResult) {
        logger.warn('Failed to parse review result', { requestId, iteration });
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
      lastResult = await this.cursorCLI.executeCommand(resumeArgs, {
        cwd: fullRepositoryPath,
      });

      iteration++;
    }

    // Format response
    const duration = Date.now() - startTime;
    logger.info('Cursor iterate completed', {
      requestId,
      repository,
      branchName,
      iterations: iteration - 1,
      success: lastResult.success,
      duration: `${duration}ms`,
    });

    const responseBody = {
      success: lastResult.success !== false,
      requestId,
      repository,
      iterations: iteration - 1,
      maxIterations,
      output: lastResult.stdout || '',
      error: lastResult.stderr || null,
      exitCode: lastResult.exitCode || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };

    // Include branchName in response if provided
    if (branchName) {
      responseBody.branchName = branchName;
    }

    return {
      status: 200,
      body: responseBody,
    };
  }
}
