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

      // Initialize GitHub authentication (configure git for non-interactive use)
      const githubAuth = new GitHubAuthService();
      await githubAuth.initialize();

      // Verify MCP configuration exists
      await this.verifyMcpConfig();

      // Test cursor-cli availability
      await this.cursorCLI.validate();

      // Start HTTP server
      await this.server.start();

      this.logger.info('cursor-runner initialized successfully', {
        port: this.server.port,
        endpoints: [
          'GET /health',
          'POST /cursor/execute',
          'POST /cursor/execute/async',
          'POST /cursor/iterate',
          'POST /cursor/iterate/async',
        ],
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

    const mcpConfigPath = '/root/.cursor/mcp.json';
    const cursorAgentsMcpPath = '/app/target/cursor-agents/dist/mcp/index.js';

    // Check if MCP config exists
    if (!fs.existsSync(mcpConfigPath)) {
      this.logger.warn('MCP config not found at /root/.cursor/mcp.json', {
        suggestion: 'Run merge-mcp-config.js to create the MCP configuration',
      });
    } else {
      this.logger.info('MCP config found', { path: mcpConfigPath });
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
      this.logger.info('Shutting down cursor-runner...');
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
    const required = ['CURSOR_CLI_PATH', 'TARGET_APP_PATH'] as const;

    const missing = (required as readonly string[]).filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
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

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await runner.shutdown();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await runner.shutdown();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  runner.initialize().catch((error) => {
    console.error('Failed to start cursor-runner:', error);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  });
}
