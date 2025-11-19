import express, {
  type Request,
  type Response,
  type NextFunction,
  type Application,
  type Router,
} from 'express';
import type { Server as HttpServer } from 'http';
import { logger } from './logger.js';
import { GitService } from './git-service.js';
import { CursorCLI } from './cursor-cli.js';
import { CommandParserService } from './command-parser-service.js';
import { ReviewAgentService } from './review-agent-service.js';
import { CursorExecutionService } from './cursor-execution-service.js';
import { FilesystemService } from './filesystem-service.js';
import { buildCallbackUrl } from './callback-url-builder.js';

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
 */
interface ErrorCallbackResponse {
  success: false;
  requestId: string;
  error: string;
  timestamp: string;
  output?: string;
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

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
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
  setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', service: 'cursor-runner' });
    });

    // Telegram webhook endpoint (forwarded from jarek-va)
    this.setupTelegramRoutes();

    // Cursor execution routes
    this.setupCursorRoutes();

    // Conversation history UI and API
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

          // Process execution synchronously - wait for completion
          const result = (await this.cursorExecution.execute({
            repository: body.repository,
            branchName: body.branchName,
            prompt: body.prompt,
            requestId,
            conversationId: body.conversationId || body.conversation_id,
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

          // Process execution asynchronously
          this.cursorExecution
            .execute({
              repository: body.repository,
              branchName: body.branchName,
              prompt: body.prompt,
              requestId,
              callbackUrl,
              conversationId: body.conversationId || body.conversation_id,
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

          // Process iteration synchronously - wait for completion
          const result = await this.cursorExecution.iterate({
            repository: body.repository,
            branchName: body.branchName,
            prompt: body.prompt,
            requestId,
            maxIterations: body.maxIterations || 25,
            conversationId: body.conversationId || body.conversation_id,
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

          // Process iteration asynchronously (fire and forget)
          // The callback webhook will be called when complete
          this.cursorExecution
            .iterate({
              repository: body.repository,
              branchName: body.branchName,
              prompt: body.prompt,
              requestId,
              maxIterations: body.maxIterations || 25,
              callbackUrl,
              conversationId: body.conversationId || body.conversation_id,
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
                // Include any partial output from the error
                const errorResponse: ErrorCallbackResponse = {
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
     */
    router.post('/conversation/new', async (req: Request, res: Response) => {
      try {
        logger.info('Force new conversation request received', {
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });

        const conversationId =
          await this.cursorExecution.conversationService.forceNewConversation();

        res.status(200).json({
          success: true,
          conversationId,
          message: 'New conversation created',
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
   * Setup conversation history UI and API routes
   */
  setupConversationRoutes(): void {
    const router: Router = express.Router();

    /**
     * GET /conversations
     * Serve the conversation history UI
     */
    router.get('/', (req: Request, res: Response) => {
      res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Conversation History - Cursor Runner</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #7f8c8d;
            font-size: 14px;
        }
        .controls {
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        button {
            background: #3498db;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }
        button:hover {
            background: #2980b9;
        }
        button:disabled {
            background: #bdc3c7;
            cursor: not-allowed;
        }
        .search-box {
            flex: 1;
            min-width: 200px;
        }
        .search-box input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        .conversations-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .conversation-item {
            padding: 15px 20px;
            border-bottom: 1px solid #eee;
            cursor: pointer;
            transition: background 0.2s;
        }
        .conversation-item:hover {
            background: #f8f9fa;
        }
        .conversation-item:last-child {
            border-bottom: none;
        }
        .conversation-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .conversation-id {
            font-family: monospace;
            font-size: 12px;
            color: #7f8c8d;
        }
        .conversation-date {
            font-size: 12px;
            color: #95a5a6;
        }
        .conversation-preview {
            font-size: 14px;
            color: #555;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .conversation-stats {
            font-size: 12px;
            color: #95a5a6;
            margin-top: 5px;
        }
        .conversation-detail {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 20px;
            margin-top: 20px;
            display: none;
        }
        .conversation-detail.active {
            display: block;
        }
        .detail-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #eee;
        }
        .detail-title {
            font-size: 18px;
            color: #2c3e50;
        }
        .close-btn {
            background: #e74c3c;
            padding: 8px 16px;
            font-size: 12px;
        }
        .close-btn:hover {
            background: #c0392b;
        }
        .messages {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .message {
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid;
        }
        .message.user {
            background: #e3f2fd;
            border-color: #2196f3;
        }
        .message.assistant {
            background: #f1f8e9;
            border-color: #8bc34a;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
            font-weight: bold;
            color: #555;
        }
        .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            line-height: 1.5;
        }
        .loading {
            text-align: center;
            padding: 40px;
            color: #7f8c8d;
        }
        .error {
            background: #fee;
            color: #c33;
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
        .empty {
            text-align: center;
            padding: 40px;
            color: #95a5a6;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Conversation History</h1>
            <div class="subtitle">View and browse Redis conversation history from cursor-runner</div>
        </header>
        
        <div class="controls">
            <button id="refreshBtn" onclick="loadConversations()">Refresh</button>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search conversations..." onkeyup="filterConversations()">
            </div>
        </div>
        
        <div id="loading" class="loading">Loading conversations...</div>
        <div id="error" class="error" style="display: none;"></div>
        <div id="conversationsList" class="conversations-list" style="display: none;"></div>
        <div id="conversationDetail" class="conversation-detail"></div>
    </div>

    <script>
        let allConversations = [];
        
        async function loadConversations() {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const list = document.getElementById('conversationsList');
            const refreshBtn = document.getElementById('refreshBtn');
            
            loading.style.display = 'block';
            error.style.display = 'none';
            list.style.display = 'none';
            refreshBtn.disabled = true;
            
            try {
                const response = await fetch('/conversations/api/list');
                if (!response.ok) {
                    throw new Error('Failed to load conversations');
                }
                const conversations = await response.json();
                allConversations = conversations;
                displayConversations(conversations);
            } catch (err) {
                error.textContent = 'Error: ' + err.message;
                error.style.display = 'block';
            } finally {
                loading.style.display = 'none';
                refreshBtn.disabled = false;
            }
        }
        
        function displayConversations(conversations) {
            const list = document.getElementById('conversationsList');
            
            if (conversations.length === 0) {
                list.innerHTML = '<div class="empty">No conversations found</div>';
                list.style.display = 'block';
                return;
            }
            
            // Sort by last accessed time (most recent first)
            conversations.sort((a, b) => 
                new Date(b.lastAccessedAt) - new Date(a.lastAccessedAt)
            );
            
            list.innerHTML = conversations.map(conv => {
                const messageCount = conv.messages ? conv.messages.length : 0;
                const preview = conv.messages && conv.messages.length > 0
                    ? conv.messages[conv.messages.length - 1].content.substring(0, 100)
                    : 'No messages';
                const createdAt = new Date(conv.createdAt).toLocaleString();
                const lastAccessed = new Date(conv.lastAccessedAt).toLocaleString();
                
                return \`
                    <div class="conversation-item" onclick="showConversation('\${conv.conversationId}')">
                        <div class="conversation-header">
                            <span class="conversation-id">\${conv.conversationId}</span>
                            <span class="conversation-date">Last: \${lastAccessed}</span>
                        </div>
                        <div class="conversation-preview">\${escapeHtml(preview)}</div>
                        <div class="conversation-stats">
                            \${messageCount} messages • Created: \${createdAt}
                        </div>
                    </div>
                \`;
            }).join('');
            
            list.style.display = 'block';
        }
        
        async function showConversation(conversationId) {
            const detail = document.getElementById('conversationDetail');
            detail.innerHTML = '<div class="loading">Loading conversation...</div>';
            detail.classList.add('active');
            
            try {
                const response = await fetch(\`/conversations/api/\${conversationId}\`);
                if (!response.ok) {
                    throw new Error('Failed to load conversation');
                }
                const conversation = await response.json();
                
                detail.innerHTML = \`
                    <div class="detail-header">
                        <div class="detail-title">Conversation: \${conversation.conversationId}</div>
                        <button class="close-btn" onclick="closeConversation()">Close</button>
                    </div>
                    <div class="messages">
                        \${conversation.messages && conversation.messages.length > 0
                            ? conversation.messages.map(msg => \`
                                <div class="message \${msg.role}">
                                    <div class="message-header">
                                        <span>\${msg.role === 'user' ? 'User' : 'Assistant'}</span>
                                        <span>\${new Date(msg.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div class="message-content">\${escapeHtml(msg.content)}</div>
                                </div>
                            \`).join('')
                            : '<div class="empty">No messages in this conversation</div>'
                        }
                    </div>
                \`;
            } catch (err) {
                detail.innerHTML = \`<div class="error">Error: \${err.message}</div>\`;
            }
        }
        
        function closeConversation() {
            document.getElementById('conversationDetail').classList.remove('active');
        }
        
        function filterConversations() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const filtered = allConversations.filter(conv => {
                const id = conv.conversationId.toLowerCase();
                const content = conv.messages 
                    ? conv.messages.map(m => m.content).join(' ').toLowerCase()
                    : '';
                return id.includes(search) || content.includes(search);
            });
            displayConversations(filtered);
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Load conversations on page load
        loadConversations();
    </script>
</body>
</html>
      `);
    });

    /**
     * GET /conversations/api/list
     * Get list of all conversations
     */
    router.get('/api/list', async (req: Request, res: Response) => {
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
     * GET /conversations/api/:conversationId
     * Get a specific conversation by ID
     */
    router.get('/api/:conversationId', async (req: Request, res: Response) => {
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

    // Mount conversation routes at root since Traefik strips /conversations prefix
    this.app.use('/', router);
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
