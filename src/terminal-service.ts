import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger.js';

/**
 * Options for command execution
 */
export interface ExecuteCommandOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Result of command execution
 */
export interface CommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * TerminalService - Handles terminal command execution
 *
 * Provides terminal command execution with timeouts.
 */
export class TerminalService {
  public readonly timeout: number;
  public readonly maxOutputSize: number;

  constructor() {
    this.timeout = parseInt(process.env.TERMINAL_COMMAND_TIMEOUT || '300000', 10); // 5 minutes default
    this.maxOutputSize = parseInt(process.env.TERMINAL_MAX_OUTPUT_SIZE || '10485760', 10); // 10MB default
  }

  /**
   * Execute terminal command
   * @param command - Command to execute
   * @param args - Command arguments
   * @param options - Execution options
   * @returns Promise resolving to command result
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    options: ExecuteCommandOptions = {}
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const cwd = options.cwd || process.cwd();
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing terminal command', { command, args, cwd });

      const child: ChildProcess = spawn(command, args, {
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
      child.stdout?.on('data', (data: Buffer) => {
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
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        const result: CommandResult = {
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
      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        logger.error('Terminal command error', { command, args, error: error.message });
        reject(error);
      });
    });
  }
}
