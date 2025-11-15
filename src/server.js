import express from 'express';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { CursorCLI } from './cursor-cli.js';
import { CommandParserService } from './command-parser-service.js';
import { ReviewAgentService } from './review-agent-service.js';
import { CursorExecutionService } from './cursor-execution-service.js';
import { FilesystemService } from './filesystem-service.js';
import { buildCallbackUrl } from './callback-url-builder.js';

/**
 * HTTP Server for cursor-runner API
 *
 * Provides endpoints for cursor command execution.
 */
export class Server {
  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.gitService = new GitService();
    this.cursorCLI = new CursorCLI();
    this.commandParser = new CommandParserService();
    this.reviewAgent = new ReviewAgentService(this.cursorCLI);
    this.filesystem = new FilesystemService();
    this.cursorExecution = new CursorExecutionService(
      this.gitService,
      this.cursorCLI,
      this.commandParser,
      this.reviewAgent,
      this.filesystem
    );

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

    // Telegram webhook endpoint (forwarded from jarek-va)
    this.setupTelegramRoutes();

    // Cursor execution routes
    this.setupCursorRoutes();

    // Error handling middleware (must be after all routes)
    // Express requires 4 parameters (err, req, res, next) to recognize error handlers
    // eslint-disable-next-line no-unused-vars
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
     * Execute cursor-cli command in a repository or repositories directory
     * Body: { repository?: string, branchName?: string, prompt: string }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     */
    router.post('/execute', async (req, res) => {
      let requestId = req.body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        logger.info('Cursor execution request received', {
          requestId,
          body: req.body,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Check if callbackUrl is provided for async processing
        const callbackUrl = req.body.callbackUrl || req.body.callback_url;
        if (callbackUrl) {
          // Return 200 OK immediately and process asynchronously
          res.status(200).json({
            success: true,
            message: 'Request accepted, processing asynchronously',
            requestId,
            timestamp: new Date().toISOString(),
          });

          // Process execution asynchronously
          this.cursorExecution
            .execute({
              repository: req.body.repository,
              branchName: req.body.branchName,
              prompt: req.body.prompt,
              requestId,
              callbackUrl,
            })
            .catch((error) => {
              logger.error('Cursor execution processing failed', {
                requestId: requestId || 'unknown',
                error: error.message,
                stack: error.stack,
                body: req.body,
              });
              // Try to notify about the error via callback
              if (callbackUrl) {
                this.cursorExecution
                  .callbackWebhook(
                    callbackUrl,
                    {
                      success: false,
                      requestId,
                      error: error.message,
                      timestamp: new Date().toISOString(),
                    },
                    requestId
                  )
                  .catch((webhookError) => {
                    logger.error('Failed to send error callback', {
                      requestId,
                      error: webhookError.message,
                    });
                  });
              }
            });
        } else {
          // No callback URL - process synchronously (backward compatibility)
          const result = await this.cursorExecution.execute({
            repository: req.body.repository,
            branchName: req.body.branchName,
            prompt: req.body.prompt,
            requestId,
          });

          res.status(result.status).json(result.body);
        }
      } catch (error) {
        logger.error('Cursor execution request failed', {
          requestId: requestId || 'unknown',
          error: error.message,
          stack: error.stack,
          body: req.body,
        });

        // If we haven't sent a response yet, send error
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId || 'unknown',
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    /**
     * POST /cursor/iterate
     * Execute cursor-cli command iteratively until completion
     * Body: { repository?: string, branchName?: string, prompt: string }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     */
    router.post('/iterate', async (req, res) => {
      let requestId = req.body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        logger.info('Cursor iterate request received', {
          requestId,
          body: req.body,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Auto-construct callback URL if not provided
        // Will use Docker network default (http://app:3000) if JAREK_VA_URL not set
        let callbackUrl = req.body.callbackUrl || req.body.callback_url;
        if (!callbackUrl) {
          callbackUrl = buildCallbackUrl();
          logger.info('Auto-constructed callback URL for iterate request', {
            requestId,
            callbackUrl,
            source: process.env.JAREK_VA_URL ? 'JAREK_VA_URL env var' : 'Docker network default',
          });
        }

        // Return 200 OK immediately
        res.status(200).json({
          success: true,
          message: 'Request accepted, processing asynchronously',
          requestId,
          timestamp: new Date().toISOString(),
        });

        // Process iteration asynchronously (fire and forget)
        // The callback webhook will be called when complete
        this.cursorExecution
          .iterate({
            repository: req.body.repository,
            branchName: req.body.branchName,
            prompt: req.body.prompt,
            requestId,
            maxIterations: req.body.maxIterations || 25,
            callbackUrl,
          })
          .catch((error) => {
            logger.error('Cursor iterate processing failed', {
              requestId: requestId || 'unknown',
              error: error.message,
              stack: error.stack,
              body: req.body,
              hasPartialOutput: !!(error.stdout || error.stderr),
            });
            // If callback URL exists, try to notify about the error
            if (callbackUrl) {
              // Include any partial output from the error
              const errorResponse = {
                success: false,
                requestId,
                error: error.message,
                timestamp: new Date().toISOString(),
              };

              // Include partial output if available (e.g., from timeout)
              if (error.stdout) {
                errorResponse.output = error.stdout;
              }
              if (error.stderr) {
                errorResponse.error = error.stderr || error.message;
              }

              this.cursorExecution
                .callbackWebhook(callbackUrl, errorResponse, requestId)
                .catch((webhookError) => {
                  logger.error('Failed to send error callback', {
                    requestId,
                    error: webhookError.message,
                  });
                });
            }
          });
      } catch (error) {
        logger.error('Cursor iterate request setup failed', {
          requestId: requestId || 'unknown',
          error: error.message,
          stack: error.stack,
          body: req.body,
        });

        // If we haven't sent a response yet, send error
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId || 'unknown',
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    // Mount cursor routes
    this.app.use('/cursor', router);
  }

  /**
   * Setup Telegram webhook routes
   */
  setupTelegramRoutes() {
    const router = express.Router();

    /**
     * POST /telegram/webhook
     * Receive forwarded Telegram webhook requests from jarek-va
     * Body: Telegram update object (message, edited_message, callback_query, etc.)
     */
    router.post('/webhook', (req, res) => {
      try {
        logger.info('Telegram webhook received', {
          update: req.body,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Basic request forwarding - just log and acknowledge
        // Future: Add actual Telegram message processing here
        const update = req.body;
        const updateType = update.message
          ? 'message'
          : update.edited_message
            ? 'edited_message'
            : update.callback_query
              ? 'callback_query'
              : 'unknown';

        logger.info('Telegram update type', { updateType });

        // Return 200 OK to acknowledge receipt
        res.status(200).json({
          success: true,
          received: true,
          updateType,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error('Telegram webhook processing failed', {
          error: error.message,
          stack: error.stack,
          body: req.body,
        });

        // Still return 200 to avoid retries from jarek-va
        res.status(200).json({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Mount telegram routes
    this.app.use('/telegram', router);
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
