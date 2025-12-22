/**
 * cursor-runner - Main entry point
 *
 * Node.js application for cursor-cli execution and code generation workflows.
 * Integrates with jarek-va for code writing tool requests.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { CursorCLI, type GenerationRequirements } from './cursor-cli.js';
import { TargetAppRunner } from './target-app.js';
import { Server } from './server.js';
import { getErrorMessage, getErrorStack } from './error-utils.js';
import type { FormattedRequest, Phase } from './request-formatter.js';
import { GitHubAuthService } from './github-auth.js';
import { validateGmailConfig, getGmailMcpEnabled } from './system-settings.js';
import { runMigrations, ensureSchemaMigrationsTable } from './migrations/migration-runner.js';

// Load environment variables
dotenv.config();

// Get __filename for ES modules
const __filename = fileURLToPath(import.meta.url);

/**
 * Test results structure
 */
interface TestResults {
  passed: number;
  failed: number;
  total: number;
  success: boolean;
}

/**
 * Result from code generation workflow
 */
interface CodeGenerationResult {
  success: boolean;
  phase?: Phase;
  output?: string;
  files?: readonly string[];
  error?: string;
  passed?: TestResults;
}

/**
 * Options for CursorRunner constructor
 */
interface CursorRunnerOptions {
  cursorCLI?: CursorCLI;
  targetAppRunner?: TargetAppRunner;
  server?: Server;
}

/**
 * Main application class
 */
class CursorRunner {
  public cursorCLI: CursorCLI;
  public targetAppRunner: TargetAppRunner;
  public server: Server;
  public logger: typeof logger;

  constructor(options: CursorRunnerOptions = {}) {
    const { cursorCLI, targetAppRunner, server: serverInstance } = options;

    this.cursorCLI = cursorCLI || new CursorCLI();
    this.targetAppRunner = targetAppRunner || new TargetAppRunner();
    this.server = serverInstance || new Server();
    this.logger = logger;
  }

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing cursor-runner...');

      // Validate configuration
      this.validateConfig();

      // Run database migrations before starting services
      try {
        this.logger.info('Running database migrations...');
        ensureSchemaMigrationsTable();
        await runMigrations();
        this.logger.info('Database migrations completed');
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.error('Failed to run database migrations', { error: errorMessage });
        // Don't throw - allow app to start even if migrations fail
        // This allows the app to start in read-only mode if needed
        this.logger.warn('Continuing startup despite migration failure');
      }

      // Initialize GitHub authentication (configure git for non-interactive use)
      const githubAuth = new GitHubAuthService();
      await githubAuth.initialize();

      // Verify MCP configuration exists
      await this.verifyMcpConfig();

      // Validate Gmail configuration (if Gmail MCP is enabled)
      this.validateGmailConfig();

      // Test cursor-cli availability
      await this.cursorCLI.validate();

      // Start HTTP server
      await this.server.start();

      this.logger.info('cursor-runner initialized successfully', {
        port: this.server.port,
        endpoints: ['GET /health', 'POST /cursor/execute', 'POST /cursor/execute/async'],
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to initialize cursor-runner', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Verify MCP configuration exists and is accessible
   */
  async verifyMcpConfig(): Promise<void> {
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const fs = await import('fs');
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const childProcess = await import('child_process');

    const mcpConfigPath = '/root/.cursor/mcp.json';
    const cursorAgentsMcpPath = '/app/target/cursor-agents/dist/mcp/index.js';
    const isDocker = fs.existsSync('/cursor');
    const mergeScriptPath = '/app/merge-mcp-config.js';

    // Check if MCP config exists
    if (!fs.existsSync(mcpConfigPath)) {
      this.logger.warn('MCP config not found at /root/.cursor/mcp.json', {
        suggestion: 'Run merge-mcp-config.js to create the MCP configuration',
      });

      // In Docker/prod, try to self-heal by running the merge script.
      // This copies the merged MCP config into /root/.cursor/mcp.json (what cursor-cli reads).
      if (isDocker && fs.existsSync(mergeScriptPath)) {
        try {
          this.logger.info('Attempting to generate MCP config by running merge-mcp-config.js', {
            script: mergeScriptPath,
          });
          childProcess.execFileSync('node', [mergeScriptPath], {
            env: process.env,
            stdio: 'inherit',
          });
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          this.logger.warn('Failed to run merge-mcp-config.js automatically', {
            error: errorMessage,
            script: mergeScriptPath,
          });
        }
      }
    } else {
      this.logger.info('MCP config found', { path: mcpConfigPath });
    }

    // Re-check and log available MCP server keys for quick diagnostics
    try {
      if (fs.existsSync(mcpConfigPath)) {
        const content = fs.readFileSync(mcpConfigPath, 'utf8');
        const parsed = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
        const keys = parsed?.mcpServers ? Object.keys(parsed.mcpServers) : [];
        this.logger.info('MCP servers available to cursor-cli', { count: keys.length, keys });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.warn('Failed to read MCP config for diagnostics', {
        error: errorMessage,
        path: mcpConfigPath,
      });
    }

    // Check if cursor-agents MCP server exists
    if (!fs.existsSync(cursorAgentsMcpPath)) {
      this.logger.warn('cursor-agents MCP server not found', {
        path: cursorAgentsMcpPath,
        suggestion: 'Ensure cursor-agents is built and mounted at /app/target/cursor-agents',
      });
    } else {
      this.logger.info('cursor-agents MCP server found', { path: cursorAgentsMcpPath });
    }
  }

  /**
   * Shutdown the application gracefully
   */
  async shutdown(): Promise<void> {
    try {
      // Log memory usage before shutdown
      const used = process.memoryUsage();

      // Capture call stack to identify what's calling shutdown
      const stack = new Error().stack;
      const stackLines = stack?.split('\n').slice(2, 10) || []; // Skip Error() and shutdown() itself

      // Use console.error for high visibility
      console.error('<<< shutdown() called >>>', {
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptime: `${Math.round(process.uptime())}s`,
        callStack: stackLines,
      });

      this.logger.info('Shutting down cursor-runner...', {
        memory: {
          rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
          external: `${Math.round(used.external / 1024 / 1024)}MB`,
        },
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        callStack: stackLines,
      });
      await this.server.stop();
      this.logger.info('cursor-runner shut down successfully');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Error during shutdown', { error: errorMessage });
    }
  }

  /**
   * Validate configuration
   */
  validateConfig(): void {
    const required = ['CURSOR_CLI_PATH'] as const;

    const missing = (required as readonly string[]).filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  /**
   * Validate Gmail configuration
   * Checks if Gmail MCP is enabled and validates required environment variables
   * Logs warnings if config is incomplete but doesn't fail startup (Gmail MCP is optional)
   */
  validateGmailConfig(): void {
    // Check if Gmail MCP is enabled via feature flag
    const gmailMcpEnabled = getGmailMcpEnabled();

    if (!gmailMcpEnabled) {
      // Gmail MCP is disabled via feature flag
      this.logger.debug('Gmail MCP is disabled (ENABLE_GMAIL_MCP is not true)');
      return;
    }

    // Gmail MCP is enabled - validate configuration
    const validation = validateGmailConfig();

    if (validation.valid) {
      this.logger.info('Gmail MCP configuration is complete', {
        enabled: true,
        hasClientId: !!process.env.GMAIL_CLIENT_ID,
        hasClientSecret: !!process.env.GMAIL_CLIENT_SECRET,
        hasRefreshToken: !!process.env.GMAIL_REFRESH_TOKEN,
        hasUserEmail: !!process.env.GMAIL_USER_EMAIL,
        hasAllowedLabels: !!process.env.GMAIL_ALLOWED_LABELS,
      });
    } else {
      this.logger.warn('Gmail MCP is enabled but configuration is incomplete', {
        enabled: true,
        missing: validation.missing,
        suggestion:
          'Set the missing environment variables to enable Gmail MCP. See .env.example for required variables.',
      });
    }
  }

  /**
   * Execute code generation workflow
   * @param request - Code generation request (already formatted)
   * @returns Result of code generation
   */
  async executeCodeGeneration(request: FormattedRequest): Promise<CodeGenerationResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Executing code generation workflow', {
        requestId: request.id,
        phase: request.phase,
        targetPath: request.targetPath,
      });

      const { phase, requirements, targetPath } = request;

      let result: CodeGenerationResult;

      // Execute based on phase
      switch (phase) {
        case 'red':
          // Generate tests first (TDD Red phase)
          this.logger.debug('Starting Red phase: test generation', { requestId: request.id });
          result = await this.cursorCLI.generateTests(
            requirements as GenerationRequirements,
            targetPath || ''
          );
          break;
        case 'green':
          // Generate implementation (TDD Green phase)
          this.logger.debug('Starting Green phase: implementation generation', {
            requestId: request.id,
          });
          result = await this.cursorCLI.generateImplementation(
            requirements as GenerationRequirements,
            targetPath || ''
          );
          break;
        case 'refactor':
          // Refactor code (TDD Refactor phase)
          this.logger.debug('Starting Refactor phase: code refactoring', { requestId: request.id });
          result = await this.cursorCLI.refactorCode(
            requirements as GenerationRequirements,
            targetPath || ''
          );
          break;
        case 'validate': {
          // Run tests and validate
          this.logger.debug('Starting Validate phase: test execution', { requestId: request.id });
          const testResult = await this.targetAppRunner.runTests(targetPath || null);
          result = {
            success: testResult.success,
            phase: 'validate',
            output: testResult.output,
            error: testResult.error,
            passed: testResult.passed,
          };
          break;
        }
        default:
          throw new Error(`Unknown phase: ${phase}`);
      }

      const duration = Date.now() - startTime;
      this.logger.info('Code generation workflow completed', {
        requestId: request.id,
        phase,
        success: result.success,
        duration: `${duration}ms`,
        filesCount: result.files?.length || 0,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error('Code generation workflow failed', {
        requestId: request.id,
        phase: request.phase,
        error: errorMessage,
        stack: errorStack,
        duration: `${duration}ms`,
      });
      throw error;
    }
  }
}

// Export for use as module
export { CursorRunner };

// Run as CLI if executed directly (but not during tests)
if (import.meta.url === `file://${__filename}` && !process.env.JEST_WORKER_ID) {
  const runner = new CursorRunner();

  // Add signal logging to diagnose shutdown triggers
  // Hostinger's orchestration layer may send SIGTERM for resource limits, health checks, or container management
  process.on('SIGTERM', async () => {
    // Use console.error for high visibility (appears in logs even if logger is buffered)
    console.error('<<< Received SIGTERM from system >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: `${Math.round(process.uptime())}s`,
      possibleCauses: [
        'Hostinger resource limit exceeded (RAM/CPU/Disk I/O)',
        'Hostinger health check failure',
        'Hostinger container orchestration restart',
        'Docker health check failure',
      ],
    });
    logger.error('<<< Received SIGTERM signal >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
    await runner.shutdown();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.error('<<< Received SIGINT from system >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: `${Math.round(process.uptime())}s`,
    });
    logger.error('<<< Received SIGINT signal >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
    await runner.shutdown();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  process.on('SIGHUP', () => {
    console.error('<<< Received SIGHUP from system >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: `${Math.round(process.uptime())}s`,
    });
    logger.info('<<< Received SIGHUP signal >>>', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
  });

  // Add uncaught exception handler
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
    // Don't exit immediately - let the process continue but log the error
  });

  // Add unhandled rejection handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : undefined;
    logger.error('Unhandled Rejection:', {
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
    // Don't exit immediately - let the process continue but log the error
  });

  // Add process exit handler
  process.on('exit', (code: number) => {
    logger.info('Process exiting', {
      code,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
    });
  });

  // Log memory usage periodically (every 5 minutes)
  setInterval(
    () => {
      const used = process.memoryUsage();
      logger.info('Memory usage:', {
        rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(used.external / 1024 / 1024)}MB`,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
    5 * 60 * 1000
  ); // Every 5 minutes

  // Keep process alive - prevent Node.js from exiting when event loop is empty
  // This ensures the HTTP server keeps running even if no active requests
  const keepAliveInterval = setInterval(() => {
    // This interval keeps the event loop active
    // We'll clear it on shutdown
  }, 1000);

  // Clear keep-alive interval on shutdown
  const originalShutdown = runner.shutdown.bind(runner);
  runner.shutdown = async function () {
    clearInterval(keepAliveInterval);
    return originalShutdown();
  };

  runner.initialize().catch((error) => {
    console.error('Failed to start cursor-runner:', error);
    logger.error('Failed to start cursor-runner', {
      error: getErrorMessage(error),
      stack: getErrorStack(error),
      timestamp: new Date().toISOString(),
    });
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  });

  // Add logging to track if process exits without explicit exit call
  const originalExit = process.exit;
  process.exit = function (code?: number): never {
    const stack = new Error().stack;
    const stackLines = stack?.split('\n').slice(2, 10) || [];
    console.error('<<< process.exit() called directly >>>', {
      code,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: `${Math.round(process.uptime())}s`,
      callStack: stackLines,
    });
    logger.error('process.exit() called directly', {
      code,
      timestamp: new Date().toISOString(),
      callStack: stackLines,
    });
    return originalExit.call(process, code);
  };
}
