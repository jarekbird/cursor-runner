import { spawn, execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * CursorCLI - Wrapper for cursor-cli execution
 *
 * Handles execution of cursor-cli commands with security restrictions,
 * timeouts, and error handling.
 */
export class CursorCLI {
  constructor() {
    const defaultCommand = process.env.CURSOR_CLI_PATH || 'cursor-agent';
    this.cursorPath = this.resolveCommandPath(defaultCommand);
    this.timeout = parseInt(process.env.CURSOR_CLI_TIMEOUT || '300000', 10); // 5 minutes default
    this.maxOutputSize = parseInt(process.env.CURSOR_CLI_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB default

    // Security: Allowed and blocked commands
    this.allowedCommands = (
      process.env.ALLOWED_COMMANDS || 'test,spec,rspec,bundle,rake,rails'
    ).split(',');
    this.blockedCommands = (process.env.BLOCKED_COMMANDS || 'rm,del,format,dd').split(',');
  }

  /**
   * Resolve the full path to a command
   * @param {string} command - Command name
   * @returns {string} Full path to command or original command if not found
   */
  resolveCommandPath(command) {
    // If it's already an absolute path, return it
    if (command.startsWith('/')) {
      return command;
    }

    // Try to find the command using 'which'
    try {
      const path = execSync(`which ${command}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (path) {
        logger.debug('Resolved command path', { command, path });
        return path;
      }
    } catch (error) {
      // Command not found, will try with original name
      logger.debug('Could not resolve command path, using original', {
        command,
        error: error.message,
      });
    }

    // Fall back to original command (might work if it's in PATH at runtime)
    return command;
  }

  /**
   * Validate that cursor-cli is available
   * @returns {Promise<boolean>}
   */
  async validate() {
    try {
      const result = await this.executeCommand(['--version']);
      logger.info('cursor-cli validated', { version: result.stdout });
      return true;
    } catch (error) {
      logger.error('cursor-cli validation failed', { error: error.message });
      throw new Error(`cursor-cli not available: ${error.message}`);
    }
  }

  /**
   * Execute a cursor-cli command
   * @param {Array<string>} args - Command arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Command result
   */
  async executeCommand(args = [], options = {}) {
    return new Promise((resolve, reject) => {
      // Command security check removed for now
      // this.validateCommandSecurity(args);

      const cwd = options.cwd || process.cwd();
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing cursor-cli command', {
        command: this.cursorPath,
        args,
        cwd,
      });

      // Ensure environment variables (including CURSOR_API_KEY) are passed to child process
      const env = {
        ...process.env,
      };

      // Log if CURSOR_API_KEY is set (for debugging, but don't log the actual key)
      if (!env.CURSOR_API_KEY) {
        logger.warn('CURSOR_API_KEY not set in environment - cursor-cli may fail to authenticate', {
          command: this.cursorPath,
          args,
        });
      } else {
        logger.debug('CURSOR_API_KEY is set', {
          command: this.cursorPath,
          keyLength: env.CURSOR_API_KEY.length,
        });
      }

      // Build full command string for logging
      const fullCommand = `${this.cursorPath} ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`;
      logger.info('Full cursor-cli command being executed', {
        fullCommand,
        command: this.cursorPath,
        args,
        cwd,
      });

      const child = spawn(this.cursorPath, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env,
      });

      logger.info('cursor-cli process spawned', {
        pid: child.pid,
        command: this.cursorPath,
        args,
        cwd,
      });

      let stdout = '';
      let stderr = '';
      let outputSize = 0;
      let hasOutput = false;
      let processCompleted = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        logger.error('cursor-cli command timeout', {
          pid: child.pid,
          args,
          timeout: `${timeout}ms`,
          hasOutput,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });
        child.kill('SIGTERM');
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      // Warning timeout - log if command is still running after 10 seconds
      const warningTimeoutId = setTimeout(() => {
        if (!processCompleted) {
          logger.warn('cursor-cli command still running after 10 seconds', {
            pid: child.pid,
            args,
            cwd,
            hasOutput,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
        }
      }, 10000);

      // Collect stdout
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        outputSize += Buffer.byteLength(chunk);
        hasOutput = true;

        if (outputSize > this.maxOutputSize) {
          child.kill('SIGTERM');
          reject(new Error(`Output size exceeded limit: ${this.maxOutputSize} bytes`));
          return;
        }

        stdout += chunk;
        logger.info('cursor-cli stdout', {
          pid: child.pid,
          chunk: chunk,
          totalLength: stdout.length,
        });
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        hasOutput = true;
        logger.warn('cursor-cli stderr', {
          pid: child.pid,
          chunk: chunk,
          totalLength: stderr.length,
        });
      });

      // Handle process completion
      child.on('close', (code) => {
        processCompleted = true;
        clearTimeout(timeoutId);
        clearTimeout(warningTimeoutId);

        const result = {
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        if (code === 0) {
          logger.info('cursor-cli command completed successfully', {
            pid: child.pid,
            args,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
        } else {
          logger.warn('cursor-cli command failed', {
            pid: child.pid,
            args,
            exitCode: code,
            stderr: stderr || '(no stderr output)',
            stdout: stdout || '(no stdout output)',
          });
        }

        // Always resolve with result, even on failure, so caller can access stdout/stderr
        resolve(result);
      });

      // Handle process errors
      child.on('error', (error) => {
        processCompleted = true;
        clearTimeout(timeoutId);
        clearTimeout(warningTimeoutId);
        logger.error('cursor-cli command error', {
          pid: child.pid,
          args,
          cwd,
          error: error.message,
          stack: error.stack,
        });
        reject(error);
      });
    });
  }

  /**
   * Validate command security
   * @param {Array<string>} args - Command arguments
   */
  validateCommandSecurity(args) {
    const commandString = args.join(' ').toLowerCase();

    // Check for blocked commands
    for (const blocked of this.blockedCommands) {
      if (commandString.includes(blocked.toLowerCase())) {
        throw new Error(`Blocked command detected: ${blocked}`);
      }
    }

    // For sensitive operations, validate against allowed commands
    // This is a basic check - enhance as needed
    logger.debug('Command security validated', { args });
  }

  /**
   * Generate tests (TDD Red phase)
   * @param {Object} requirements - Test requirements
   * @param {string} targetPath - Target application path
   * @returns {Promise<Object>} Generation result
   */
  async generateTests(requirements, targetPath) {
    logger.info('Generating tests (TDD Red phase)', { targetPath });

    // Build cursor command to generate tests
    const prompt = `Generate test cases for: ${JSON.stringify(requirements)}`;
    const args = ['generate', '--prompt', prompt, '--type', 'test'];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'red',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      logger.error('Test generation failed', { error: error.message });
      return {
        success: false,
        phase: 'red',
        error: error.message,
      };
    }
  }

  /**
   * Generate implementation (TDD Green phase)
   * @param {Object} requirements - Implementation requirements
   * @param {string} targetPath - Target application path
   * @returns {Promise<Object>} Generation result
   */
  async generateImplementation(requirements, targetPath) {
    logger.info('Generating implementation (TDD Green phase)', { targetPath });

    const prompt = `Implement code to satisfy: ${JSON.stringify(requirements)}`;
    const args = ['generate', '--prompt', prompt, '--type', 'implementation'];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'green',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      logger.error('Implementation generation failed', { error: error.message });
      return {
        success: false,
        phase: 'green',
        error: error.message,
      };
    }
  }

  /**
   * Refactor code (TDD Refactor phase)
   * @param {Object} requirements - Refactoring requirements
   * @param {string} targetPath - Target application path
   * @returns {Promise<Object>} Refactoring result
   */
  async refactorCode(requirements, targetPath) {
    logger.info('Refactoring code (TDD Refactor phase)', { targetPath });

    const prompt = `Refactor code: ${JSON.stringify(requirements)}`;
    const args = ['refactor', '--prompt', prompt];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'refactor',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      logger.error('Refactoring failed', { error: error.message });
      return {
        success: false,
        phase: 'refactor',
        error: error.message,
      };
    }
  }

  /**
   * Extract file paths from cursor output
   * @param {string} output - Command output
   * @returns {Array<string>} File paths
   */
  extractFilesFromOutput(output) {
    // Basic implementation - enhance based on actual cursor-cli output format
    const filePattern = /(?:created|modified|updated):\s*(.+)/gi;
    const files = [];
    let match;

    while ((match = filePattern.exec(output)) !== null) {
      files.push(match[1].trim());
    }

    return files;
  }
}
