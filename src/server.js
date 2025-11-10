import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { TerminalService } from './terminal-service.js';
import { CursorCLI } from './cursor-cli.js';

/**
 * HTTP Server for cursor-runner API
 * 
 * Provides endpoints for git operations and terminal commands.
 */
export class Server {
  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.gitService = new GitService();
    this.terminalService = new TerminalService();
    this.cursorCLI = new CursorCLI();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    // JSON body parser
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
      });
      next();
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', service: 'cursor-runner' });
    });

    // Cursor execution routes
    this.setupCursorRoutes();

    // Git routes
    this.setupGitRoutes();

    // Error handling middleware (must be after all routes)
    this.app.use((err, req, res, next) => {
      this.handleError(err, req, res);
    });
  }

  /**
   * Setup cursor execution routes
   */
  setupCursorRoutes() {
    const router = express.Router();

    /**
     * POST /cursor/execute
     * Execute cursor-cli command in a repository
     * Body: { repository: string, branchName: string, command: string }
     */
    router.post('/execute', async (req, res, next) => {
      const startTime = Date.now();
      let requestId = req.body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        logger.info('Cursor execution request received', {
          requestId,
          body: req.body,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Validate required parameters
        const { repository, branchName, command } = req.body;

        if (!repository) {
          return res.status(400).json({
            success: false,
            error: 'repository is required',
            requestId,
          });
        }

        if (!branchName) {
          return res.status(400).json({
            success: false,
            error: 'branchName is required',
            requestId,
          });
        }

        if (!command) {
          return res.status(400).json({
            success: false,
            error: 'command is required',
            requestId,
          });
        }

        // Check if repository exists locally
        const repositoryPath = this.gitService.repositoriesPath;
        const fullRepositoryPath = path.join(repositoryPath, repository);

        if (!existsSync(fullRepositoryPath)) {
          return res.status(404).json({
            success: false,
            error: `Repository not found locally: ${repository}. Please clone it first using POST /git/clone`,
            requestId,
          });
        }

        // Checkout the branch
        logger.info('Checking out branch', { repository, branchName });
        try {
          await this.gitService.checkoutBranch(repository, branchName);
        } catch (error) {
          logger.error('Failed to checkout branch', { repository, branchName, error: error.message });
          return res.status(500).json({
            success: false,
            error: `Failed to checkout branch: ${error.message}`,
            requestId,
          });
        }

        // Parse command (split by spaces, handle quoted arguments)
        const commandArgs = this.parseCommand(command);

        // Append instructions to the command
        // If the command has a prompt/instruction argument, append to it
        const instructions = '\n\nIf you need to run a terminal command, stop and request that the caller run the terminal command for you. Be explicit about what terminal command needs to be run.';
        
        // Find prompt/instruction arguments and append instructions
        const modifiedArgs = [...commandArgs];
        let foundPromptFlag = false;
        
        for (let i = 0; i < modifiedArgs.length; i++) {
          // Common prompt flags: --prompt, -p, --instruction, --message, etc.
          if ((modifiedArgs[i] === '--prompt' || 
               modifiedArgs[i] === '-p' || 
               modifiedArgs[i] === '--instruction' ||
               modifiedArgs[i] === '--message') && 
              i + 1 < modifiedArgs.length) {
            // Append instructions to the next argument (the prompt text)
            modifiedArgs[i + 1] = modifiedArgs[i + 1] + instructions;
            foundPromptFlag = true;
            break;
          }
        }
        
        // If no prompt flag found, append instructions to the last argument
        if (!foundPromptFlag && modifiedArgs.length > 0) {
          modifiedArgs[modifiedArgs.length - 1] = modifiedArgs[modifiedArgs.length - 1] + instructions;
        }

        // Execute cursor command in the repository directory
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

        // Format response
        const duration = Date.now() - startTime;
        logger.info('Cursor execution completed', {
          requestId,
          repository,
          branchName,
          success: result.success,
          duration: `${duration}ms`,
        });

        res.json({
          success: result.success !== false,
          requestId,
          repository,
          branchName,
          command: modifiedArgs,
          output: result.stdout || '',
          error: result.stderr || null,
          exitCode: result.exitCode || 0,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Log error with full context
        const duration = Date.now() - startTime;
        logger.error('Cursor execution request failed', {
          requestId: requestId || 'unknown',
          error: error.message,
          stack: error.stack,
          duration: `${duration}ms`,
          body: req.body,
        });

        res.status(500).json({
          success: false,
          error: error.message,
          requestId: requestId || 'unknown',
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Mount cursor routes
    this.app.use('/cursor', router);
  }

  /**
   * Parse command string into arguments array
   * Handles quoted arguments and spaces
   * @param {string} command - Command string
   * @returns {Array<string>} Command arguments
   */
  parseCommand(command) {
    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if ((char === '"' || char === "'") && (i === 0 || command[i - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  /**
   * Enhanced error handling
   * @param {Error} err - Error object
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  handleError(err, req, res) {
    // Log error with full context
    logger.error('HTTP Error Handler', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      body: req.body,
      query: req.query,
      headers: {
        'user-agent': req.get('user-agent'),
        'content-type': req.get('content-type'),
      },
    });

    // Determine status code
    let statusCode = err.status || err.statusCode || 500;

    // Handle specific error types
    if (err.name === 'ValidationError') {
      statusCode = 400;
    } else if (err.name === 'UnauthorizedError') {
      statusCode = 401;
    } else if (err.name === 'ForbiddenError') {
      statusCode = 403;
    } else if (err.name === 'NotFoundError') {
      statusCode = 404;
    }

    // Format error response
    const errorResponse = {
      success: false,
      error: err.message || 'Internal server error',
      timestamp: new Date().toISOString(),
      path: req.path,
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
  }

  /**
   * Setup git-related routes
   */
  setupGitRoutes() {
    const router = express.Router();

    /**
     * POST /git/clone
     * Clone a repository to /repositories folder
     * Body: { repositoryUrl: string, repositoryName?: string }
     */
    router.post('/clone', async (req, res, next) => {
      try {
        const { repositoryUrl, repositoryName } = req.body;

        if (!repositoryUrl) {
          return res.status(400).json({
            success: false,
            error: 'repositoryUrl is required',
          });
        }

        const result = await this.gitService.cloneRepository(repositoryUrl, repositoryName);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    /**
     * GET /git/repositories
     * List locally cloned repositories
     */
    router.get('/repositories', async (req, res, next) => {
      try {
        const repositories = await this.gitService.listRepositories();
        res.json({
          success: true,
          repositories,
          count: repositories.length,
        });
      } catch (error) {
        next(error);
      }
    });

    /**
     * POST /git/checkout
     * Checkout to a repository/branch
     * Body: { repository: string, branch: string }
     */
    router.post('/checkout', async (req, res, next) => {
      try {
        const { repository, branch } = req.body;

        if (!repository || !branch) {
          return res.status(400).json({
            success: false,
            error: 'repository and branch are required',
          });
        }

        const result = await this.gitService.checkoutBranch(repository, branch);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    /**
     * POST /git/push
     * Push local branch to origin
     * Body: { repository: string, branch: string }
     */
    router.post('/push', async (req, res, next) => {
      try {
        const { repository, branch } = req.body;

        if (!repository || !branch) {
          return res.status(400).json({
            success: false,
            error: 'repository and branch are required',
          });
        }

        const result = await this.gitService.pushBranch(repository, branch);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    /**
     * POST /git/pull
     * Pull local branch from origin
     * Body: { repository: string, branch: string }
     */
    router.post('/pull', async (req, res, next) => {
      try {
        const { repository, branch } = req.body;

        if (!repository || !branch) {
          return res.status(400).json({
            success: false,
            error: 'repository and branch are required',
          });
        }

        const result = await this.gitService.pullBranch(repository, branch);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Mount git routes
    this.app.use('/git', router);
  }

  /**
   * Start the server
   */
  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info('HTTP Server started', {
          port: this.port,
          environment: process.env.NODE_ENV || 'development',
        });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('HTTP Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

