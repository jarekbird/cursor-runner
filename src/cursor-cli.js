import { spawn } from 'child_process';
import { logger } from './logger.js';

/**
 * CursorCLI - Wrapper for cursor-cli execution
 *
 * Handles execution of cursor-cli commands with security restrictions,
 * timeouts, and error handling.
 */
export class CursorCLI {
  constructor() {
    this.cursorPath = process.env.CURSOR_CLI_PATH || 'cursor';
    this.timeout = parseInt(process.env.CURSOR_CLI_TIMEOUT || '300000', 10); // 5 minutes default
    this.maxOutputSize = parseInt(process.env.CURSOR_CLI_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB default
    this._ptyModule = null; // Lazy-loaded

    // Security: Allowed and blocked commands
    this.allowedCommands = (
      process.env.ALLOWED_COMMANDS || 'test,spec,rspec,bundle,rake,rails'
    ).split(',');
    this.blockedCommands = (process.env.BLOCKED_COMMANDS || 'rm,del,format,dd').split(',');
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
    // Validate command security
    this.validateCommandSecurity(args);

    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || this.timeout;

    // Lazy-load node-pty if available (before creating Promise)
    if (this._ptyModule === null) {
      try {
        // eslint-disable-next-line node/no-unsupported-features/es-syntax
        const ptyModule = await import('node-pty').catch(() => null);
        this._ptyModule = ptyModule?.default || ptyModule || null;
      } catch (error) {
        this._ptyModule = null;
      }
    }

    return new Promise((resolve, reject) => {
      logger.debug('Executing cursor-cli command', {
        command: this.cursorPath,
        args,
        cwd,
      });

      let stdout = '';
      let stderr = '';
      let outputSize = 0;
      let lastOutputTime = Date.now();
      let hasReceivedOutput = false;
      let completed = false;

      // Try to use a pseudo-TTY so cursor behaves like an interactive session
      let child;
      let usePty = false;

      if (this._ptyModule) {
        try {
          child = this._ptyModule.spawn(this.cursorPath, args, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd,
            env: process.env,
          });
          usePty = true;
          logger.debug('Using PTY for cursor-cli execution');
        } catch (error) {
          logger.warn('Failed to start cursor-cli with PTY, falling back to spawn', {
            error: error.message,
          });
        }
      }

      // Fallback to regular spawn
      if (!usePty) {
        child = spawn(this.cursorPath, args, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        });
        logger.debug('Using regular spawn for cursor-cli execution');
      }

      // Set timeout
      const timeoutId = setTimeout(() => {
        if (completed) return;

        logger.error('cursor-cli command timeout', {
          command: this.cursorPath,
          args,
          cwd,
          timeout: `${timeout}ms`,
          hasReceivedOutput,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          lastOutputTime: lastOutputTime ? new Date(lastOutputTime).toISOString() : null,
        });

        try {
          if (child.kill) {
            child.kill('SIGTERM');
          }
        } catch (e) {
          // Process may already be dead
        }

        // Try SIGKILL if SIGTERM doesn't work after a short delay (spawned processes only)
        if (child.pid && child.kill) {
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch (e) {
              // Ignore
            }
          }, 1000);
        }

        completed = true;
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      // Log heartbeat every 30 seconds to show process is still running
      const heartbeatInterval = setInterval(() => {
        const timeSinceLastOutput = Date.now() - lastOutputTime;
        logger.info('cursor-cli command heartbeat', {
          command: this.cursorPath,
          args,
          hasReceivedOutput,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          timeSinceLastOutput: `${timeSinceLastOutput}ms`,
          elapsed: `${Date.now() - (lastOutputTime || Date.now())}ms`,
        });
      }, 30000);

      const handleData = (data) => {
        const chunk = data.toString();
        outputSize += Buffer.byteLength(chunk);
        lastOutputTime = Date.now();
        hasReceivedOutput = true;

        // Log output chunks in real-time (truncate for logging)
        const logChunk = chunk.length > 500 ? chunk.substring(0, 500) + '...' : chunk;
        logger.info('cursor-cli stdout chunk', {
          command: this.cursorPath,
          args,
          chunkLength: chunk.length,
          chunkPreview: logChunk.replace(/\n/g, '\\n'),
          totalStdoutLength: stdout.length + chunk.length,
        });

        if (outputSize > this.maxOutputSize) {
          try {
            if (child.kill) {
              child.kill('SIGTERM');
            }
          } catch (e) {
            // Ignore
          }
          completed = true;
          reject(new Error(`Output size exceeded limit: ${this.maxOutputSize} bytes`));
          return;
        }

        stdout += chunk;
      };

      // PTY: single data stream
      if (child.onData) {
        child.onData(handleData);
      } else if (child.stdout) {
        // Fallback: regular child process
        child.stdout.on('data', handleData);
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          lastOutputTime = Date.now();
          hasReceivedOutput = true;

          const logChunk = chunk.length > 500 ? chunk.substring(0, 500) + '...' : chunk;
          logger.warn('cursor-cli stderr chunk', {
            command: this.cursorPath,
            args,
            chunkLength: chunk.length,
            chunkPreview: logChunk.replace(/\n/g, '\\n'),
            totalStderrLength: stderr.length + chunk.length,
          });

          stderr += chunk;
        });
      }

      const handleExit = (code) => {
        if (completed) return;
        completed = true;

        clearTimeout(timeoutId);
        clearInterval(heartbeatInterval);

        const result = {
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        logger.info('cursor-cli command process closed', {
          args,
          exitCode: code,
          hasReceivedOutput,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });

        if (code === 0) {
          logger.info('cursor-cli command completed successfully', { args });
        } else {
          logger.warn('cursor-cli command failed', { args, exitCode: code, stderr });
        }

        // Always resolve with result, even on failure, so caller can access stdout/stderr
        resolve(result);
      };

      if (child.onExit) {
        // PTY exit event
        child.onExit(({ exitCode }) => {
          handleExit(exitCode);
        });
      } else {
        // Regular child process
        child.on('close', handleExit);
        child.on('error', (error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutId);
          clearInterval(heartbeatInterval);
          logger.error('cursor-cli command error', {
            args,
            error: error.message,
            hasReceivedOutput,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          reject(error);
        });
      }
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
