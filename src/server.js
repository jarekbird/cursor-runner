import express from 'express';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { TerminalService } from './terminal-service.js';

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

    // Git routes
    this.setupGitRoutes();

    // Error handling middleware (must be after all routes)
    this.app.use((err, req, res, next) => {
      this.handleError(err, req, res);
    });
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

