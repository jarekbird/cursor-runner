import express, {
  type Request,
  type Response,
  type NextFunction,
  type Application,
  type Router,
} from 'express';
import type { Server as HttpServer } from 'http';
import type { IncomingMessage } from 'http';
import path from 'path';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { CursorCLI } from './cursor-cli.js';
import { CommandParserService } from './command-parser-service.js';
import { CursorExecutionService } from './cursor-execution-service.js';
import { FilesystemService } from './filesystem-service.js';
import { getWebhookSecret } from './callback-url-builder.js';
import { FileTreeService } from './file-tree-service.js';
import { AgentConversationService } from './agent-conversation-service.js';
import { TaskService } from './task-service.js';
import type Redis from 'ioredis';
import { getRepositoriesPath, getTargetAppPath } from './utils/path-resolver.js';
import { WebSocketServer, type WebSocket } from 'ws';

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
 * Options for Server constructor
 */
export interface ServerOptions {
  /**
   * If true, disables background workers, schedulers, and long-running processes.
   * Useful for testing to prevent hanging.
   */
  disableBackgroundWorkers?: boolean;
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
  public filesystem: FilesystemService;
  public cursorExecution: CursorExecutionService;
  public agentConversationService: AgentConversationService;
  public taskService: TaskService;
  public server?: HttpServer;
  private readonly disableBackgroundWorkers: boolean;
  private wsServer?: WebSocketServer;
  private readonly wsClientsByTopic = new Map<string, Set<WebSocket>>();
  private readonly wsUnsubscribers: Array<() => void> = [];

  constructor(redisClient?: Redis, options: ServerOptions = {}) {
    this.disableBackgroundWorkers = options.disableBackgroundWorkers ?? false;
    this.app = express();
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.gitService = new GitService();
    this.cursorCLI = new CursorCLI();
    this.commandParser = new CommandParserService();
    this.filesystem = new FilesystemService();
    // Pass Redis client to CursorExecutionService so ConversationService can use it
    // This ensures all services share the same Redis connection for proper cleanup
    this.cursorExecution = new CursorExecutionService(
      this.gitService,
      this.cursorCLI,
      this.commandParser,
      this.filesystem,
      redisClient
    );
    // Allow dependency injection of Redis for testing
    this.agentConversationService = new AgentConversationService(redisClient);
    this.taskService = new TaskService();

    // Hook realtime broadcasts to Redis-backed updates (no-op until websocket clients subscribe)
    this.wsUnsubscribers.push(
      this.cursorExecution.conversationService.onConversationUpdated((event) => {
        if (event.type === 'conversation.created' || event.type === 'conversation.updated') {
          this.broadcastWs(`conversation:${event.conversationId}`, {
            type: event.type,
            conversationId: event.conversationId,
            conversation: event.conversation,
            ...(event.type === 'conversation.updated' ? { reason: event.reason } : {}),
          });
        }
      })
    );

    this.wsUnsubscribers.push(
      this.agentConversationService.onConversationUpdated((event) => {
        if (
          event.type === 'agent_conversation.created' ||
          event.type === 'agent_conversation.updated'
        ) {
          this.broadcastWs(`agent_conversation:${event.conversationId}`, {
            type: event.type,
            conversationId: event.conversationId,
            conversation: event.conversation,
            ...(event.type === 'agent_conversation.updated' ? { reason: event.reason } : {}),
          });
        }
      })
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware(): void {
    // CORS middleware - allow requests from frontend
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.get('origin');
      // Allow requests from localhost (development) and any configured origins
      const allowedOrigins = [
        'http://localhost:3002',
        'http://localhost:80',
        'http://localhost',
        'https://localhost',
        process.env.FRONTEND_URL,
      ].filter(Boolean);

      if (origin && (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }

      next();
    });

    // Request logging middleware (before routes)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      // Only log API routes to reduce noise
      if (req.path.startsWith('/api') || req.path.startsWith('/conversations/api')) {
        logger.info('Incoming API request', {
          method: req.method,
          path: req.path,
          url: req.url,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
      }
      next();
    });

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

    // Tasks API endpoints
    // Must be before conversation routes to avoid /api/tasks being caught by /api/:conversationId
    this.setupTaskRoutes();

    // Conversation history API endpoints (UI is served by jarek-va-ui)
    // Must be after other routes to avoid conflicts
    // IMPORTANT: This has a catch-all /:conversationId route, so more specific routes must come first
    this.setupConversationRoutes();

    // 404 handler for unmatched routes (must be after all routes, before error handler)
    this.app.use((req: Request, res: Response) => {
      logger.warn('404 - Route not found', {
        method: req.method,
        path: req.path,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        headers: {
          host: req.get('host'),
          'x-forwarded-for': req.get('x-forwarded-for'),
          'x-forwarded-proto': req.get('x-forwarded-proto'),
        },
      });
      res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.path,
        method: req.method,
      });
    });

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
     * Authentication middleware for public cursor execution endpoints
     * Validates WEBHOOK_SECRET if configured
     */
    const authenticateWebhook = (req: Request, res: Response, next: NextFunction): void => {
      const expectedSecret = getWebhookSecret();

      // If WEBHOOK_SECRET is not configured, allow access (for development)
      if (!expectedSecret) {
        next();
        return;
      }

      // Check for secret in headers or query parameter
      const providedSecret =
        req.headers['x-webhook-secret'] ||
        req.headers['x-cursor-runner-secret'] ||
        (req.query as { secret?: string }).secret;

      if (providedSecret !== expectedSecret) {
        const secretStatus = providedSecret ? '[present]' : '[missing]';
        logger.warn('Unauthorized cursor execution request - invalid secret', {
          providedSecret: secretStatus,
          ip: req.ip,
          path: req.path,
        });
        res.status(401).json({
          success: false,
          error: 'Unauthorized - invalid or missing webhook secret',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      next();
    };

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
     * callbackUrl is optional - if provided, results will be sent to the callback URL when complete.
     *
     * Authentication: Requires WEBHOOK_SECRET in header (X-Webhook-Secret or X-Cursor-Runner-Secret)
     * or query parameter (?secret=...) if WEBHOOK_SECRET environment variable is set.
     */
    router.post(
      '/execute/async',
      authenticateWebhook,
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

          // Get callbackUrl if provided (optional)
          const callbackUrl = body.callbackUrl || body.callback_url;

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
      logger.info('List conversations request received', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        path: req.path,
        url: req.url,
      });
      try {
        const conversations = await this.cursorExecution.conversationService.listConversations();
        logger.info('List conversations success', {
          count: conversations.length,
        });
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
     * GET /api/working-directory/files
     * Get file tree for the cursor working directory
     * Uses REPOSITORIES_PATH parent directory (/cursor) to show full structure
     * Returns a FileNode[] tree structure
     * IMPORTANT: This route must come before /:conversationId to avoid route conflicts
     */
    router.get('/working-directory/files', async (req: Request, res: Response) => {
      try {
        const fileTreeService = new FileTreeService();

        // Determine working directory path
        // Priority: Use REPOSITORIES_PATH parent directory, fallback to TARGET_APP_PATH
        // REPOSITORIES_PATH is now relative to TARGET_APP_PATH (e.g., TARGET_APP_PATH/repositories)
        // So the parent directory of REPOSITORIES_PATH is TARGET_APP_PATH
        let workingDirectoryPath: string | undefined;

        const repositoriesPath = getRepositoriesPath();
        if (repositoriesPath) {
          // Use parent directory of REPOSITORIES_PATH to show full structure
          // e.g., TARGET_APP_PATH/repositories -> TARGET_APP_PATH
          const parentDir = path.dirname(repositoriesPath);
          // If parent is root (/), use repositoriesPath itself
          // Otherwise use parent to show full structure
          if (parentDir === '/' || parentDir === repositoriesPath) {
            workingDirectoryPath = repositoriesPath;
          } else {
            workingDirectoryPath = parentDir;
          }
        }

        // Fallback to TARGET_APP_PATH if REPOSITORIES_PATH not available
        if (!workingDirectoryPath) {
          workingDirectoryPath = getTargetAppPath();
        }

        if (!workingDirectoryPath) {
          res.status(500).json({
            success: false,
            error: 'Neither REPOSITORIES_PATH nor TARGET_APP_PATH configured',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Check if working directory exists
        if (!this.filesystem.exists(workingDirectoryPath)) {
          res.status(404).json({
            success: false,
            error: `Working directory not found: ${workingDirectoryPath}`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        logger.info('Working directory file tree request received', {
          path: workingDirectoryPath,
          repositoriesPath,
          targetAppPath: getTargetAppPath(),
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        // Build file tree
        const fileTree = fileTreeService.buildFileTree(workingDirectoryPath);

        res.json(fileTree);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get working directory file tree', {
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
     * IMPORTANT: This route must come after /new, /list, and /working-directory/files to avoid route conflicts
     * IMPORTANT: Skip reserved paths like "tasks" and "agent" that are handled by other routers
     */
    router.get('/:conversationId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { conversationId } = req.params;

        // Skip reserved paths that are handled by other routers
        const reservedPaths = ['tasks', 'agent', 'working-directory'];
        if (reservedPaths.includes(conversationId)) {
          return next(); // Let it fall through to other routers
        }

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
          .execute({
            repository,
            branchName,
            prompt: message,
            requestId,
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

    // Mount conversation API routes at /api (for Traefik routing)
    // Traefik routes /conversations/api/* to cursor-runner (priority 20, higher than jarek-va-ui)
    // Traefik strips /conversations prefix, so /conversations/api/list becomes /api/list
    // Router mounted at /api with routes /list and /:conversationId
    // Final routes: /api/list and /api/:conversationId (accessible as /conversations/api/list from frontend)
    this.app.use('/api', router);

    // Also mount at /conversations/api for direct access (bypassing Traefik)
    // This allows the frontend to access the API directly when running locally
    // e.g., http://localhost:3001/conversations/api/list
    this.app.use('/conversations/api', router);
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
        const repositoryPath = path.join(this.gitService.repositoriesPath, repository);

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
   * Traefik strips /agent-conversations prefix, so /agent-conversations/api/list becomes /api/agent/list
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
     * Get list of all agent conversations with optional pagination
     * Query params: limit (default: all), offset (default: 0)
     * Note: Router is mounted at /api/agent, so route is /list
     */
    router.get('/list', async (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
        const sortBy = req.query.sortBy as
          | 'createdAt'
          | 'lastAccessedAt'
          | 'messageCount'
          | undefined;
        const sortOrder = req.query.sortOrder as 'asc' | 'desc' | undefined;

        // Validate pagination parameters
        if (limit !== undefined && (isNaN(limit) || limit < 1)) {
          res.status(400).json({
            success: false,
            error: 'limit must be a positive integer',
          });
          return;
        }
        if (offset !== undefined && (isNaN(offset) || offset < 0)) {
          res.status(400).json({
            success: false,
            error: 'offset must be a non-negative integer',
          });
          return;
        }

        // Validate sorting parameters
        if (sortBy && !['createdAt', 'lastAccessedAt', 'messageCount'].includes(sortBy)) {
          res.status(400).json({
            success: false,
            error: 'sortBy must be one of: createdAt, lastAccessedAt, messageCount',
          });
          return;
        }
        if (sortOrder && !['asc', 'desc'].includes(sortOrder)) {
          res.status(400).json({
            success: false,
            error: 'sortOrder must be one of: asc, desc',
          });
          return;
        }

        const result = await this.agentConversationService.listConversations({
          limit,
          offset,
          sortBy,
          sortOrder,
        });

        res.json({
          conversations: result.conversations,
          pagination: {
            total: result.total,
            limit: limit ?? result.total,
            offset: offset ?? 0,
            hasMore:
              offset !== undefined && limit !== undefined ? offset + limit < result.total : false,
          },
        });
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
     * Note: Router is mounted at /api/agent, so route is /new
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
     * Note: Router is mounted at /api/agent, so route is /:id/message
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
     * Note: Router is mounted at /api/agent, so route is /:id
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

    // Mount agent conversation API routes at /api/agent
    // Traefik strips /agent-conversations prefix, so /agent-conversations/api/list becomes /api/list
    // But we mount at /api/agent to avoid conflicts with regular conversation API routes at /api
    // So /agent-conversations/api/list becomes /api/agent/list
    this.app.use('/api/agent', router);
  }

  /**
   * Setup tasks API routes
   * Provides endpoints for managing agent tasks in the shared SQLite database
   */
  setupTaskRoutes(): void {
    const router: Router = express.Router();

    /**
     * GET /api/tasks
     * List all tasks, optionally filtered by status
     * Query params: ?status=0 (optional, filters by status)
     */
    router.get('/', async (req: Request, res: Response) => {
      try {
        const statusParam = req.query.status;
        const status = statusParam !== undefined ? parseInt(String(statusParam), 10) : undefined;

        if (status !== undefined && isNaN(status)) {
          res.status(400).json({
            success: false,
            error: 'Invalid status parameter. Must be a number.',
          });
          return;
        }

        const tasks = this.taskService.listTasks(status);
        res.json(tasks);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to list tasks', {
          error: err.message,
          stack: err.stack,
          query: req.query,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * GET /api/tasks/:id
     * Get a specific task by ID
     */
    router.get('/:id', async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({
            success: false,
            error: 'Invalid task ID. Must be a number.',
          });
          return;
        }

        const task = this.taskService.getTaskById(id);
        if (!task) {
          res.status(404).json({
            success: false,
            error: 'Task not found',
          });
          return;
        }

        res.json(task);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to get task', {
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
     * POST /api/tasks
     * Create a new task
     * Body: { prompt: string, order?: number, status?: number }
     */
    router.post('/', async (req: Request, res: Response) => {
      try {
        const body = req.body as { prompt: string; order?: number; status?: number };
        const { prompt, order, status } = body;

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: 'Prompt is required and must be a non-empty string',
          });
          return;
        }

        const task = this.taskService.createTask(
          prompt.trim(),
          order ?? 0,
          (status as number | undefined) ?? 0
        );

        res.status(201).json(task);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to create task', {
          error: err.message,
          stack: err.stack,
          body: req.body,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * PUT /api/tasks/:id
     * Update a task
     * Body: { prompt?: string, status?: number, order?: number }
     */
    router.put('/:id', async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({
            success: false,
            error: 'Invalid task ID. Must be a number.',
          });
          return;
        }

        const body = req.body as { prompt?: string; status?: number; order?: number };
        const updates: { prompt?: string; status?: number; order?: number } = {};

        if (body.prompt !== undefined) {
          if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
            res.status(400).json({
              success: false,
              error: 'Prompt must be a non-empty string',
            });
            return;
          }
          updates.prompt = body.prompt.trim();
        }

        if (body.status !== undefined) {
          if (typeof body.status !== 'number' || isNaN(body.status)) {
            res.status(400).json({
              success: false,
              error: 'Status must be a number',
            });
            return;
          }
          updates.status = body.status;
        }

        if (body.order !== undefined) {
          if (typeof body.order !== 'number' || isNaN(body.order)) {
            res.status(400).json({
              success: false,
              error: 'Order must be a number',
            });
            return;
          }
          updates.order = body.order;
        }

        const task = this.taskService.updateTask(id, updates);
        if (!task) {
          res.status(404).json({
            success: false,
            error: 'Task not found',
          });
          return;
        }

        res.json(task);
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to update task', {
          error: err.message,
          stack: err.stack,
          id: req.params.id,
          body: req.body,
        });
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    /**
     * DELETE /api/tasks/:id
     * Delete a task
     */
    router.delete('/:id', async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
          res.status(400).json({
            success: false,
            error: 'Invalid task ID. Must be a number.',
          });
          return;
        }

        const deleted = this.taskService.deleteTask(id);
        if (!deleted) {
          res.status(404).json({
            success: false,
            error: 'Task not found',
          });
          return;
        }

        res.json({ success: true, message: 'Task deleted' });
      } catch (error) {
        const err = error as Error;
        logger.error('Failed to delete task', {
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

    // Mount tasks API routes at /api/tasks
    this.app.use('/api/tasks', router);
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

  private addWsClient(topic: string, ws: WebSocket): void {
    const set = this.wsClientsByTopic.get(topic) ?? new Set<WebSocket>();
    set.add(ws);
    this.wsClientsByTopic.set(topic, set);
  }

  private removeWsClient(topic: string, ws: WebSocket): void {
    const set = this.wsClientsByTopic.get(topic);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.wsClientsByTopic.delete(topic);
    }
  }

  private broadcastWs(topic: string, payload: unknown): void {
    const clients = this.wsClientsByTopic.get(topic);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          logger.warn('Failed to send websocket message', {
            error: error instanceof Error ? error.message : String(error),
            topic,
          });
        }
      }
    }
  }

  private async sendWsSnapshot(topic: string, ws: WebSocket): Promise<void> {
    try {
      if (topic.startsWith('conversation:')) {
        const conversationId = topic.substring('conversation:'.length);
        const conversation =
          await this.cursorExecution.conversationService.getConversationById(conversationId);
        if (conversation) {
          ws.send(
            JSON.stringify({
              type: 'conversation.snapshot',
              conversationId,
              conversation,
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'Conversation not found or conversation storage unavailable',
              conversationId,
            })
          );
        }
      } else if (topic.startsWith('agent_conversation:')) {
        const conversationId = topic.substring('agent_conversation:'.length);
        const conversation = await this.agentConversationService.getConversation(conversationId);
        if (conversation) {
          ws.send(
            JSON.stringify({
              type: 'agent_conversation.snapshot',
              conversationId,
              conversation,
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: 'error',
              error: 'Agent conversation not found or conversation storage unavailable',
              conversationId,
            })
          );
        }
      }
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  private setupWebSockets(): void {
    if (!this.server) {
      logger.warn('Cannot setup websockets before HTTP server is started');
      return;
    }

    if (this.wsServer) {
      return;
    }

    this.wsServer = new WebSocketServer({ noServer: true });
    const wsServer = this.wsServer; // Store in local variable for TypeScript

    this.server.on('upgrade', (request: IncomingMessage, socket, head) => {
      try {
        const host = request.headers.host || 'localhost';
        const url = new URL(request.url || '/', `http://${host}`);

        const pathname = url.pathname;
        const conversationId = url.searchParams.get('conversationId') || url.searchParams.get('id');
        if (!conversationId) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing conversationId');
          socket.destroy();
          return;
        }

        // Supported websocket endpoints:
        // - Note-taking conversations: /conversations/api/ws (Traefik -> /api/ws) and /api/ws (direct)
        // - Agent conversations: /agent-conversations/api/ws (Traefik -> /api/agent/ws) and /api/agent/ws (direct)
        let topic: string | null = null;
        if (pathname === '/api/ws' || pathname === '/conversations/api/ws') {
          topic = `conversation:${conversationId}`;
        } else if (pathname === '/api/agent/ws' || pathname === '/agent-conversations/api/ws') {
          topic = `agent_conversation:${conversationId}`;
        }

        if (!topic) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          this.addWsClient(topic!, ws);

          void this.sendWsSnapshot(topic!, ws);

          ws.on('close', () => {
            this.removeWsClient(topic!, ws);
          });

          ws.on('error', () => {
            this.removeWsClient(topic!, ws);
          });
        });
      } catch (error) {
        logger.warn('Websocket upgrade failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        socket.destroy();
      }
    });

    logger.info('WebSocket server ready', {
      endpoints: ['/api/ws', '/api/agent/ws'],
    });
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
        this.setupWebSockets();
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

  /**
   * Shutdown all resources (workers, connections, timers, etc.)
   * Call this in tests to ensure clean exit
   */
  async shutdown(): Promise<void> {
    // Stop HTTP server if running
    await this.stop();

    // Stop websocket server
    if (this.wsServer) {
      try {
        this.wsServer.close();
      } catch (error) {
        logger.warn('Failed to close websocket server', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.wsServer = undefined;
    }

    // Unsubscribe realtime listeners
    for (const unsub of this.wsUnsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.wsUnsubscribers.length = 0;

    // Close Redis connections in services
    // Both AgentConversationService and ConversationService (via CursorExecutionService)
    // use the injected Redis client, which will be closed externally
    // But we should ensure they're not holding any references

    // Clear any intervals/timeouts if we had any
    // (Currently Server doesn't create any, but this is a safe place to add cleanup)

    logger.info('Server shutdown complete');
  }
}
