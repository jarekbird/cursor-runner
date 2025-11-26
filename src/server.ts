import express, {
  type Request,
  type Response,
  type NextFunction,
  type Application,
  type Router,
} from 'express';
import type { Server as HttpServer } from 'http';
import path from 'path';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { CursorCLI } from './cursor-cli.js';
import { CommandParserService } from './command-parser-service.js';
import { ReviewAgentService } from './review-agent-service.js';
import { CursorExecutionService } from './cursor-execution-service.js';
import { FilesystemService } from './filesystem-service.js';
import { buildCallbackUrl } from './callback-url-builder.js';
import { FileTreeService } from './file-tree-service.js';
import { AgentConversationService } from './agent-conversation-service.js';

/**
 * Request body for cursor execution endpoints
 */
interface CursorExecuteRequest {
  id?: string;
  repository?: string;
  branchName?: string;
  prompt: string;
  callbackUrl?: string;
  callback_url?: string;
  maxIterations?: number;
  conversationId?: string;
  conversation_id?: string;
  queueType?: 'default' | 'telegram' | 'api';
}

/**
 * Telegram update object (simplified)
 */
interface TelegramUpdate {
  message?: unknown;
  edited_message?: unknown;
  callback_query?: unknown;
  [key: string]: unknown;
}

/**
 * Error with status/statusCode properties
 */
interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  name: string;
}

/**
 * Command error with output properties (for cursor execution errors)
 */
interface CommandErrorWithOutput extends Error {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

/**
 * Error response for callback webhooks
 * Note: This interface is kept for reference but the actual error callbacks
 * now use a more complete structure matching CallbackWebhookPayload
 */
interface ErrorCallbackResponse {
  success: false;
  requestId: string;
  error: string;
  timestamp: string;
  output?: string;
  iterations?: number;
  maxIterations?: number;
  exitCode?: number;
}

/**
 * HTTP Server for cursor-runner API
 *
 * Provides endpoints for cursor command execution.
 */
export class Server {
  public app: Application;
  public port: number;
  public gitService: GitService;
  public cursorCLI: CursorCLI;
  public commandParser: CommandParserService;
  public reviewAgent: ReviewAgentService;
  public filesystem: FilesystemService;
  public cursorExecution: CursorExecutionService;
  public agentConversationService: AgentConversationService;
  public server?: HttpServer;

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.gitService = new GitService();
    this.cursorCLI = new CursorCLI();
    this.commandParser = new CommandParserService();
    // CursorCLI implements the CursorCLIInterface required by ReviewAgentService
    this.reviewAgent = new ReviewAgentService(this.cursorCLI);
    this.filesystem = new FilesystemService();
    this.cursorExecution = new CursorExecutionService(
      this.gitService,
      this.cursorCLI,
      this.commandParser,
      this.reviewAgent,
      this.filesystem
    );
    this.agentConversationService = new AgentConversationService();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());
  }

  /**
   * Setup API routes
   */
  setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      logger.info('Health check requested', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        service: 'cursor-runner',
      });
      res.json({ status: 'ok', service: 'cursor-runner' });
    });

    // Diagnostic endpoint for execution queue status
    this.app.get('/health/queue', (req: Request, res: Response) => {
      const queueStatus = this.cursorCLI.getQueueStatus();
      logger.info('Queue status requested', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        service: 'cursor-runner',
        queueStatus,
      });
      res.json({
        status: 'ok',
        service: 'cursor-runner',
        queue: queueStatus,
        warning:
          queueStatus.available === 0 && queueStatus.waiting > 0
            ? 'All execution slots are occupied. Requests are queued. If this persists, cursor-cli processes may be hung.'
            : null,
      });
    });

    // Telegram webhook endpoint (forwarded from jarek-va)
    this.setupTelegramRoutes();

    // Cursor execution routes
    this.setupCursorRoutes();

    // Repository file browser API endpoints
    this.setupRepositoryRoutes();

    // Agent conversation API endpoints
    this.setupAgentConversationRoutes();

    // Conversation history API endpoints (UI is served by jarek-va-ui)
    // Must be after other routes to avoid conflicts
    this.setupConversationRoutes();

    // Error handling middleware (must be after all routes)
    // Express requires 4 parameters (err, req, res, next) to recognize error handlers
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
      this.handleError(err, req, res);
    });
  }

  /**
   * Detect if a request is from telegram based on requestId pattern
   * Telegram requests have requestId starting with "telegram-"
   */
  private detectQueueType(requestId: string): 'telegram' | 'default' {
    return requestId.startsWith('telegram-') ? 'telegram' : 'default';
  }

  /**
   * Setup cursor execution routes
   */
  setupCursorRoutes(): void {
    const router: Router = express.Router();

    /**
     * POST /cursor/execute
     * Execute cursor-cli command synchronously - waits for completion before responding
     * Body: { repository?: string, branchName?: string, prompt: string }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     */
    router.post(
      '/execute',
      async (req: Request<unknown, unknown, CursorExecuteRequest>, res: Response) => {
        const body = req.body as CursorExecuteRequest;
        const requestId = body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          logger.info('Cursor execution request received (synchronous)', {
            requestId,
            body: req.body,
            ip: req.ip,
            userAgent: req.get('user-agent'),
          });

          // Use queueType from request body if provided, otherwise detect from requestId pattern
          const queueType = body.queueType || this.detectQueueType(requestId);

          // Process execution synchronously - wait for completion
          const result = (await this.cursorExecution.execute({
            repository: body.repository,
            branchName: body.branchName,
            prompt: body.prompt,
            requestId,
            conversationId: body.conversationId || body.conversation_id,
            queueType,
          })) as { status: number; body: unknown };

          res.status(result.status).json(result.body);
        } catch (error) {
          const err = error as Error;
          logger.error('Cursor execution request failed', {
            requestId: requestId || 'unknown',
            error: err.message,
            stack: err.stack,
            body: req.body,
          });

          // If we haven't sent a response yet, send error
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: err.message,
              requestId: requestId || 'unknown',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    );

    /**
     * POST /cursor/execute/async
     * Execute cursor-cli command asynchronously - returns immediately and processes in background
     * Body: { repository?: string, branchName?: string, prompt: string, callbackUrl?: string }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     * callbackUrl is required for async processing.
     */
    router.post(
      '/execute/async',
      async (req: Request<unknown, unknown, CursorExecuteRequest>, res: Response) => {
        const body = req.body as CursorExecuteRequest;
        const requestId = body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          logger.info('Cursor execution request received (async)', {
            requestId,
            body: req.body,
            ip: req.ip,
            userAgent: req.get('user-agent'),
          });

          // Check if callbackUrl is provided for async processing
          const callbackUrl = body.callbackUrl || body.callback_url;
          if (!callbackUrl) {
            res.status(400).json({
              success: false,
              error: 'callbackUrl is required for async execution',
              requestId,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Return 200 OK immediately and process asynchronously
          res.status(200).json({
            success: true,
            message: 'Request accepted, processing asynchronously',
            requestId,
            timestamp: new Date().toISOString(),
          });

          // Use queueType from request body if provided, otherwise detect from requestId pattern
          const queueType = body.queueType || this.detectQueueType(requestId);

          // Process execution asynchronously
          this.cursorExecution
            .execute({
              repository: body.repository,
              branchName: body.branchName,
              prompt: body.prompt,
              requestId,
              callbackUrl,
              conversationId: body.conversationId || body.conversation_id,
              queueType,
            })
            .catch((error: Error) => {
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
                  .catch((webhookError: Error) => {
                    logger.error('Failed to send error callback', {
                      requestId,
                      error: webhookError.message,
                    });
                  });
              }
            });
        } catch (error) {
          const err = error as Error;
          logger.error('Cursor execution request setup failed', {
            requestId: requestId || 'unknown',
            error: err.message,
            stack: err.stack,
            body: req.body,
          });

          // If we haven't sent a response yet, send error
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: err.message,
              requestId: requestId || 'unknown',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    );

    /**
     * POST /cursor/iterate
     * Execute cursor-cli command iteratively until completion - waits for completion before responding
     * Body: { repository?: string, branchName?: string, prompt: string, maxIterations?: number }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     */
    router.post(
      '/iterate',
      async (req: Request<unknown, unknown, CursorExecuteRequest>, res: Response) => {
        const body = req.body as CursorExecuteRequest;
        const requestId = body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          logger.info('Cursor iterate request received (synchronous)', {
            requestId,
            body: req.body,
            ip: req.ip,
            userAgent: req.get('user-agent'),
          });

          // Use queueType from request body if provided, otherwise detect from requestId pattern
          const queueType = body.queueType || this.detectQueueType(requestId);

          // Process iteration synchronously - wait for completion
          const result = await this.cursorExecution.iterate({
            repository: body.repository,
            branchName: body.branchName,
            prompt: body.prompt,
            requestId,
            maxIterations: body.maxIterations || 5,
            conversationId: body.conversationId || body.conversation_id,
            queueType,
          });

          // Convert IterationResult to HTTP response
          // Both ErrorResponse and SuccessResponse have status and body fields
          res.status(result.status).json(result.body);
        } catch (error) {
          const err = error as Error;
          logger.error('Cursor iterate request failed', {
            requestId: requestId || 'unknown',
            error: err.message,
            stack: err.stack,
            body: req.body,
          });

          // If we haven't sent a response yet, send error
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: err.message,
              requestId: requestId || 'unknown',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    );

    /**
     * POST /cursor/iterate/async
     * Execute cursor-cli command iteratively until completion - returns immediately and processes in background
     * Body: { repository?: string, branchName?: string, prompt: string, maxIterations?: number, callbackUrl?: string }
     * If repository is not provided, uses the repositories directory as working directory
     * Prompt is required and will be used to construct the cursor command internally.
     * If callbackUrl is not provided, will auto-construct one.
     */
    router.post(
      '/iterate/async',
      async (req: Request<unknown, unknown, CursorExecuteRequest>, res: Response) => {
        const body = req.body as CursorExecuteRequest;
        const requestId = body.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
          logger.info('Cursor iterate request received (async)', {
            requestId,
            conversationId: body.conversationId || body.conversation_id || 'none',
            body: req.body,
            ip: req.ip,
            userAgent: req.get('user-agent'),
          });

          // Auto-construct callback URL if not provided
          // Will use Docker network default (http://app:3000) if JAREK_VA_URL not set
          let callbackUrl = body.callbackUrl || body.callback_url;
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

          // Use queueType from request body if provided, otherwise detect from requestId pattern
          const queueType = body.queueType || this.detectQueueType(requestId);

          // Process iteration asynchronously (fire and forget)
          // The callback webhook will be called when complete
          this.cursorExecution
            .iterate({
              repository: body.repository,
              branchName: body.branchName,
              prompt: body.prompt,
              requestId,
              maxIterations: body.maxIterations || 5,
              callbackUrl,
              conversationId: body.conversationId || body.conversation_id,
              queueType,
            })
            .catch((error: CommandErrorWithOutput) => {
              logger.error('Cursor iterate processing failed', {
                requestId: requestId || 'unknown',
                error: error.message,
                stack: error.stack,
                body: req.body,
                hasPartialOutput: !!(error.stdout || error.stderr),
              });
              // If callback URL exists, try to notify about the error
              if (callbackUrl) {
                // Use the same structure as iterate() method for consistency
                // This ensures cursor-agents receives consistent callback format
                const errorResponse: ErrorCallbackResponse = {
                  success: false,
                  requestId,
                  error: error.message,
                  timestamp: new Date().toISOString(),
                  iterations: 0, // No iterations completed if error occurred before/during iterate
                  maxIterations: body.maxIterations || 5,
                };

                // Include partial output if available (e.g., from timeout)
                if (error.stdout) {
                  errorResponse.output = error.stdout;
                }
                if (error.stderr) {
                  errorResponse.error = error.stderr || error.message;
                }
                if (error.exitCode !== undefined && error.exitCode !== null) {
                  errorResponse.exitCode = error.exitCode;
                }

                this.cursorExecution
                  .callbackWebhook(callbackUrl, errorResponse, requestId)
                  .catch((webhookError: Error) => {
                    logger.error('Failed to send error callback', {
                      requestId,
                      error: webhookError.message,
                    });
                  });
              }
            });
        } catch (error) {
          const err = error as Error;
          logger.error('Cursor iterate request setup failed', {
            requestId: requestId || 'unknown',
            error: err.message,
            stack: err.stack,
            body: req.body,
          });

          // If we haven't sent a response yet, send error
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: err.message,
              requestId: requestId || 'unknown',
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    );

    /**
     * POST /cursor/conversation/new
     * Force create a new conversation ID
     * Returns the new conversation ID that will be used for subsequent requests
     * Body: { queueType?: 'default' | 'telegram' | 'api' } (optional, defaults to 'default')
     */
    router.post('/conversation/new', async (req: Request, res: Response) => {
      try {
        const body = req.body as { queueType?: 'default' | 'telegram' | 'api' };
        const queueType = body.queueType || 'default';

        logger.info('Force new conversation request received', {
          ip: req.ip,
          userAgent: req.get('user-agent'),
          queueType,
        });

        const conversationId =
          await this.cursorExecution.conversationService.forceNewConversation(queueType);

        res.status(200).json({
          success: true,
          conversationId,
          message: 'New conversation created',
          queueType,
        });
      } catch (error) {
        const err = error as Error;
        logger.error('Force new conversation request failed', {
          error: err.message,
          stack: err.stack,
        });

        res.status(500).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Mount cursor routes
    this.app.use('/cursor', router);
  }

  /**
   * Setup Telegram webhook routes
   */
  setupTelegramRoutes(): void {
    const router: Router = express.Router();

    /**
     * POST /telegram/webhook
     * Receive forwarded Telegram webhook requests from jarek-va
     * Body: Telegram update object (message, edited_message, callback_query, etc.)
     */
    router.post('/webhook', (req: Request<unknown, unknown, TelegramUpdate>, res: Response) => {
      try {
        logger.info('Telegram webhook received', {
          update: req.body,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Basic request forwarding - just log and acknowledge
        // Future: Add actual Telegram message processing here
        const update = req.body as TelegramUpdate;
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
        const err = error as Error;
        logger.error('Telegram webhook processing failed', {
          error: err.message,
          stack: err.stack,
          body: req.body,
        });

        // Still return 200 to avoid retries from jarek-va
        res.status(200).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Mount telegram routes
    this.app.use('/telegram', router);
  }

  /**
   * Setup conversation history API routes
   * UI is served by jarek-va-ui at /conversations
   * API endpoints are at /conversations/api/* (routed to cursor-runner via Traefik)
   */
  setupConversationRoutes(): void {
    const router: Router = express.Router();

    // Middleware to prevent browser caching of API responses
    // This prevents browsers from caching HTML responses during deployments
    router.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });

    /**
     * GET /conversations/api/list
     * Get list of all conversations
     */
    router.get('/list', async (req: Request, res: Response) => {
      try {
        const conversations = await this.cursorExecution.conversationService.listConversations();
        res.json(conversations);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to list conversations', {
          error: err.message,
          stack: err.stack,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * POST /conversations/api/new
     * Create a new conversation
     * Body: { queueType?: 'default' | 'telegram' | 'api' } (optional, defaults to 'api')
     * IMPORTANT: This route must come before /:conversationId to avoid route conflicts
     */
    router.post('/new', async (req: Request, res: Response) => {
      try {
        const body = req.body as { queueType?: 'default' | 'telegram' | 'api' };
        const queueType = body.queueType || 'api';

        logger.info('New conversation request received', {
          ip: req.ip,
          userAgent: req.get('user-agent'),
          queueType,
        });

        const conversationId =
          await this.cursorExecution.conversationService.forceNewConversation(queueType);

        res.status(200).json({
          success: true,
          conversationId,
          message: 'New conversation created',
          queueType,
        });
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to create new conversation', {
          error: err.message,
          stack: err.stack,
        });
        res.status(500).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    /**
     * GET /conversations/api/:conversationId
     * Get a specific conversation by ID
     * IMPORTANT: This route must come after /new and /list to avoid route conflicts
     */
    router.get('/:conversationId', async (req: Request, res: Response) => {
      try {
        const { conversationId } = req.params;
        const conversation =
          await this.cursorExecution.conversationService.getConversationById(conversationId);

        if (!conversation) {
          res.status(404).json({
            success: false,
            error: 'Conversation not found',
          });
          return;
        }

        res.json(conversation);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get conversation', {
          error: err.message,
          stack: err.stack,
          conversationId: req.params.conversationId,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * POST /conversations/api/:conversationId/message
     * Send a message to a conversation and trigger cursor execution
     * Body: { message: string, repository?: string, branchName?: string }
     */
    router.post('/:conversationId/message', async (req: Request, res: Response) => {
      try {
        const { conversationId } = req.params;
        const body = req.body as { message: string; repository?: string; branchName?: string };
        const { message, repository, branchName } = body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: 'Message is required and must be a non-empty string',
          });
          return;
        }

        // Verify conversation exists
        const conversation =
          await this.cursorExecution.conversationService.getConversationById(conversationId);

        if (!conversation) {
          res.status(404).json({
            success: false,
            error: 'Conversation not found',
          });
          return;
        }

        const requestId = `ui-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        logger.info('Message send request received', {
          requestId,
          conversationId,
          messageLength: message.length,
          repository,
          branchName,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Return 200 OK immediately
        res.status(200).json({
          success: true,
          message: 'Message accepted, processing asynchronously',
          requestId,
          conversationId,
          timestamp: new Date().toISOString(),
        });

        // Process message asynchronously (fire and forget)
        this.cursorExecution
          .iterate({
            repository,
            branchName,
            prompt: message,
            requestId,
            maxIterations: 5,
            conversationId,
            queueType: 'api',
          })
          .catch((error: Error) => {
            logger.error('Message processing failed', {
              requestId,
              conversationId,
              error: error.message,
              stack: error.stack,
            });
          });
      } catch (error) {
        const err = error as Error;
        logger.error('Message send request failed', {
          error: err.message,
          stack: err.stack,
          conversationId: req.params.conversationId,
        });

        // If we haven't sent a response yet, send error
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    // Mount conversation API routes at /api
    // Traefik routes /conversations/api/* to cursor-runner (priority 20, higher than jarek-va-ui)
    // Traefik strips /conversations prefix, so /conversations/api/list becomes /api/list
    // Router mounted at /api with routes /list and /:conversationId
    // Final routes: /api/list and /api/:conversationId (accessible as /conversations/api/list from frontend)
    this.app.use('/api', router);
  }

  /**
   * Setup repository file browser API routes
   */
  setupRepositoryRoutes(): void {
    const router: Router = express.Router();
    const fileTreeService = new FileTreeService();

    /**
     * GET /repositories/api/:repository/files
     * Get file tree for a repository
     * Returns a FileNode[] tree structure
     */
    router.get('/:repository/files', async (req: Request, res: Response) => {
      try {
        const { repository } = req.params;

        if (!repository) {
          res.status(400).json({
            success: false,
            error: 'Repository name is required',
          });
          return;
        }

        // Build repository path
        const repositoryPath = path.join(
          this.gitService.repositoriesPath,
          repository
        );

        // Check if repository exists
        if (!this.filesystem.exists(repositoryPath)) {
          res.status(404).json({
            success: false,
            error: `Repository '${repository}' not found`,
          });
          return;
        }

        logger.info('File tree request received', {
          repository,
          path: repositoryPath,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Build file tree
        const fileTree = fileTreeService.buildFileTree(repositoryPath);

        res.json(fileTree);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get repository file tree', {
          error: err.message,
          stack: err.stack,
          repository: req.params.repository,
        });

        res.status(500).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Mount repository API routes at /repositories/api
    this.app.use('/repositories/api', router);
  }

  /**
   * Setup agent conversation API routes
   * Agent conversations are separate from regular conversations and are used for voice-based interactions
   * API endpoints are at /agent-conversations/api/* (routed to cursor-runner via Traefik)
   */
  setupAgentConversationRoutes(): void {
    const router: Router = express.Router();

    // Middleware to prevent browser caching of API responses
    router.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });

    /**
     * GET /agent-conversations/api/list
     * Get list of all agent conversations
     */
    router.get('/list', async (req: Request, res: Response) => {
      try {
        const conversations = await this.agentConversationService.listConversations();
        res.json(conversations);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to list agent conversations', {
          error: err.message,
          stack: err.stack,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * POST /agent-conversations/api/new
     * Create a new agent conversation
     * Body: { agentId?: string, metadata?: Record<string, unknown> } (optional)
     * IMPORTANT: This route must come before /:id to avoid route conflicts
     */
    router.post('/new', async (req: Request, res: Response) => {
      try {
        const body = req.body as { agentId?: string; metadata?: Record<string, unknown> };

        logger.info('New agent conversation request received', {
          ip: req.ip,
          userAgent: req.get('user-agent'),
          agentId: body.agentId,
        });

        const conversation = await this.agentConversationService.createConversation(body.agentId);

        if (body.metadata) {
          conversation.metadata = body.metadata;
          // Save again with metadata
          await this.agentConversationService.updateConversation(conversation);
        }

        res.status(200).json({
          success: true,
          conversationId: conversation.conversationId,
          message: 'New agent conversation created',
        });
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to create new agent conversation', {
          error: err.message,
          stack: err.stack,
        });
        res.status(500).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    /**
     * POST /agent-conversations/api/:id/message
     * Send a message to an agent conversation
     * Body: { role: 'user' | 'assistant', content: string, source?: 'voice' | 'text' }
     * IMPORTANT: This route must come before /:id to avoid route conflicts
     */
    router.post('/:id/message', async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const body = req.body as {
          role: 'user' | 'assistant';
          content: string;
          source?: 'voice' | 'text';
        };

        if (!body.content || !body.role) {
          res.status(400).json({
            success: false,
            error: 'Missing required fields: role, content',
          });
          return;
        }

        const message: import('./agent-conversation-service.js').AgentMessage = {
          role: body.role,
          content: body.content,
          timestamp: new Date().toISOString(),
          source: body.source || 'text',
        };

        await this.agentConversationService.addMessage(id, message);

        const conversation = await this.agentConversationService.getConversation(id);

        res.status(200).json({
          success: true,
          conversationId: conversation?.conversationId || id,
          message: 'Message added to conversation',
        });
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to add message to agent conversation', {
          error: err.message,
          stack: err.stack,
          id: req.params.id,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * GET /agent-conversations/api/:id
     * Get a specific agent conversation by ID
     * IMPORTANT: This route must come after /new, /list, and /:id/message to avoid route conflicts
     */
    router.get('/:id', async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const conversation = await this.agentConversationService.getConversation(id);

        if (!conversation) {
          res.status(404).json({
            success: false,
            error: 'Agent conversation not found',
          });
          return;
        }

        res.json(conversation);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get agent conversation', {
          error: err.message,
          stack: err.stack,
          id: req.params.id,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    // Mount agent conversation API routes at /agent-conversations/api
    this.app.use('/agent-conversations/api', router);
  }

  /**
   * Enhanced error handling
   * @param err - Error object
   * @param req - Express request
   * @param res - Express response
   */
  handleError(err: HttpError, req: Request, res: Response): void {
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
    const errorResponse: {
      success: false;
      error: string;
      timestamp: string;
      path: string;
      stack?: string;
    } = {
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
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
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
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
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
