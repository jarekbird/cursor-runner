import { spawn } from 'child_process';
import { logger } from './logger.js';

/**
 * TerminalService - Handles terminal command execution
 *
 * Provides secure terminal command execution with validation, timeouts, and security restrictions.
 */
export class TerminalService {
  constructor() {
    this.timeout = parseInt(process.env.TERMINAL_COMMAND_TIMEOUT || '300000', 10); // 5 minutes default
    this.maxOutputSize = parseInt(process.env.TERMINAL_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB default

    // Security: Allowed and blocked commands
    this.allowedCommands = (
      process.env.ALLOWED_TERMINAL_COMMANDS || 'git,cursor,npm,node,bundle,rails,rspec'
    ).split(',');
    this.blockedCommands = (
      process.env.BLOCKED_TERMINAL_COMMANDS || 'rm,del,format,dd,sudo,su'
    ).split(',');
  }

  /**
   * Execute terminal command safely
   * @param {string} command - Command to execute
   * @param {Array<string>} args - Command arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Command result
   */
  async executeCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      // Validate command security
      this.validateCommandSecurity(command, args);

      const cwd = options.cwd || process.cwd();
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing terminal command', { command, args, cwd });

      const child = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false, // Never use shell: true for security
      });

      let stdout = '';
      let stderr = '';
      let outputSize = 0;

      // Set timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      // Collect stdout
      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        outputSize += Buffer.byteLength(chunk);

        if (outputSize > this.maxOutputSize) {
          child.kill('SIGTERM');
          reject(new Error(`Output size exceeded limit: ${this.maxOutputSize} bytes`));
          return;
        }

        stdout += chunk;
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);

        const result = {
          success: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        // Always resolve with result, even on failure, so caller can access stdout/stderr
        if (code === 0) {
          logger.debug('Terminal command completed successfully', { command, args });
        } else {
          logger.warn('Terminal command failed', { command, args, exitCode: code, stderr });
        }

        resolve(result);
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.error('Terminal command error', { command, args, error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Validate command security
   * @param {string} command - Command to validate
   * @param {Array<string>} args - Command arguments
   */
  validateCommandSecurity(command, args) {
    const commandLower = command.toLowerCase();
    const commandString = [command, ...args].join(' ').toLowerCase();

    // Check for blocked commands
    for (const blocked of this.blockedCommands) {
      if (
        commandLower.includes(blocked.toLowerCase()) ||
        commandString.includes(blocked.toLowerCase())
      ) {
        throw new Error(`Blocked command detected: ${blocked}`);
      }
    }

    // Check against allowed commands (if whitelist is enforced)
    // For now, we only block dangerous commands, but you can enable strict whitelisting
    if (process.env.ENFORCE_COMMAND_WHITELIST === 'true') {
      const isAllowed = this.allowedCommands.some((allowed) =>
        commandLower.includes(allowed.toLowerCase())
      );

      if (!isAllowed) {
        throw new Error(`Command not in whitelist: ${command}`);
      }
    }

    logger.debug('Command security validated', { command, args });
  }
}
