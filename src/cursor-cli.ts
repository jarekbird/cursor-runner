import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';

/**
 * Options for cursor-cli command execution
 */
export interface ExecuteCommandOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Result of cursor-cli command execution
 */
export interface CommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Extended error with command output
 */
interface CommandError extends Error {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

/**
 * PTY module type (node-pty)
 */
interface IPty {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }
  ): IPtyProcess;
}

/**
 * PTY process interface
 */
interface IPtyProcess {
  pid: number;
  onData(callback: (data: string) => void): void;
  onExit(callback: (data: { exitCode: number }) => void): void;
  kill(signal?: string): void;
  write(data: string): void;
}

/**
 * Requirements for code generation (can be string or structured object)
 */
export type GenerationRequirements = string | Record<string, unknown>;

/**
 * Generation result for TDD phases
 */
export interface GenerationResult {
  success: boolean;
  phase: 'red' | 'green' | 'refactor';
  output?: string;
  files?: readonly string[];
  error?: string;
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  private count: number;
  private waiting: Array<() => void> = [];

  constructor(count: number) {
    this.count = count;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift();
      if (resolve) {
        resolve();
      }
    } else {
      this.count++;
    }
  }

  getAvailable(): number {
    return this.count;
  }

  getWaiting(): number {
    return this.waiting.length;
  }
}

/**
 * CursorCLI - Wrapper for cursor-cli execution
 *
 * Handles execution of cursor-cli commands with timeouts and error handling.
 */
export class CursorCLI {
  private readonly cursorPath: string;
  private readonly timeout: number;
  private readonly maxOutputSize: number;
  private _ptyModule: IPty | null = null; // Lazy-loaded
  private readonly semaphore: Semaphore;

  constructor(cursorPath?: string) {
    this.cursorPath = cursorPath || process.env.CURSOR_CLI_PATH || 'cursor';
    // Hard timeout (wall-clock). Must be >= idle timeout to make idle-timeout meaningful.
    // Default: 30 minutes.
    const timeoutValue = parseInt(process.env.CURSOR_CLI_TIMEOUT || '1800000', 10);
    this.timeout = isNaN(timeoutValue) || timeoutValue <= 0 ? 1800000 : timeoutValue; // 30 minutes default
    const maxOutputSizeValue = parseInt(process.env.CURSOR_CLI_MAX_OUTPUT_SIZE || '10485760', 10);
    this.maxOutputSize =
      isNaN(maxOutputSizeValue) || maxOutputSizeValue <= 0 ? 10485760 : maxOutputSizeValue; // 10MB default

    // Concurrency limit - default to 5, configurable via CURSOR_CLI_MAX_CONCURRENT
    const maxConcurrentValue = parseInt(process.env.CURSOR_CLI_MAX_CONCURRENT || '5', 10);
    const maxConcurrent =
      isNaN(maxConcurrentValue) || maxConcurrentValue <= 0 ? 5 : maxConcurrentValue;
    this.semaphore = new Semaphore(maxConcurrent);

    logger.info('CursorCLI initialized', {
      maxConcurrent,
      timeout: this.timeout,
      maxOutputSize: this.maxOutputSize,
    });
  }

  /**
   * Get execution queue status
   * @returns Object with available and waiting counts
   */
  getQueueStatus(): { available: number; waiting: number; maxConcurrent: number } {
    return {
      available: this.semaphore.getAvailable(),
      waiting: this.semaphore.getWaiting(),
      maxConcurrent: parseInt(process.env.CURSOR_CLI_MAX_CONCURRENT || '5', 10),
    };
  }

  /**
   * Validate that cursor-cli is available
   * @returns Promise resolving to true if available
   */
  async validate(): Promise<boolean> {
    try {
      const result = await this.executeCommand(['--version']);
      logger.info('cursor-cli validated', { version: result.stdout });
      return true;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('cursor-cli validation failed', { error: errorMessage });
      throw new Error(`cursor-cli not available: ${errorMessage}`);
    }
  }

  /**
   * Format args for logging - summarizes long prompts to improve readability
   */
  private formatArgsForLogging(args: readonly string[]): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      argCount: args.length,
      flags: [] as string[],
      promptSummary: null as {
        preview: string;
        length: number;
        lineCount: number;
        firstLine: string;
      } | null,
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      // Collect flags (arguments starting with --)
      if (typeof arg === 'string' && arg.startsWith('--')) {
        (summary.flags as string[]).push(arg);
      }

      // Summarize long prompts (typically the last argument or very long strings)
      if (typeof arg === 'string' && arg.length > 200) {
        const lines = arg.split('\n');
        const lineCount = lines.length;

        // Find first non-empty line (skip leading whitespace/newlines)
        const firstMeaningfulLine = lines.find((line) => line.trim().length > 0) || lines[0] || '';
        const firstLinePreview = firstMeaningfulLine.trim().substring(0, 100);

        // Create a short preview (first 80 chars of first meaningful line)
        const preview =
          firstLinePreview.length > 80
            ? firstLinePreview.substring(0, 80) + '...'
            : firstLinePreview;

        summary.promptSummary = {
          preview,
          length: arg.length,
          lineCount,
          firstLine: firstLinePreview,
        };
      }
    }

    // If no long prompt found but args exist, show first few short args
    if (!summary.promptSummary && args.length > 0) {
      const shortArgs = args
        .filter((arg) => typeof arg === 'string' && arg.length <= 200)
        .slice(0, 3);
      if (shortArgs.length > 0) {
        summary.shortArgs = shortArgs;
      }
    }

    return summary;
  }

  /**
   * Execute a cursor-cli command
   * @param args - Command arguments
   * @param options - Execution options
   * @returns Promise resolving to command result
   */
  async executeCommand(
    args: readonly string[] = [],
    options: ExecuteCommandOptions = {}
  ): Promise<CommandResult> {
    // Acquire semaphore to limit concurrency
    const available = this.semaphore.getAvailable();
    const waiting = this.semaphore.getWaiting();

    if (waiting > 0 || available <= 0) {
      logger.info('Waiting for cursor-cli execution slot', {
        available,
        waiting,
        args: this.formatArgsForLogging(args),
      });
    }

    await this.semaphore.acquire();

    // Track that we've acquired the semaphore
    const currentAvailable = this.semaphore.getAvailable();
    const currentWaiting = this.semaphore.getWaiting();
    logger.debug('Acquired cursor-cli execution slot', {
      available: currentAvailable,
      waiting: currentWaiting,
      args: this.formatArgsForLogging(args),
    });

    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || this.timeout;
    const idleTimeoutValue = parseInt(process.env.CURSOR_CLI_IDLE_TIMEOUT || '600000', 10);
    const idleTimeout =
      isNaN(idleTimeoutValue) || idleTimeoutValue <= 0 ? 600000 : idleTimeoutValue; // 10 minutes default

    // PTY can introduce TTY-specific behavior that interferes with MCP/stdin-stdout workflows.
    // Default to spawn unless explicitly enabled.
    const allowPty = (process.env.CURSOR_RUNNER_USE_PTY || '').toLowerCase() === 'true';

    // Lazy-load node-pty only when PTY mode is enabled.
    // This avoids native-module load failures in environments where node-pty isn't built (e.g., some CI runners)
    // and avoids unnecessary overhead when PTY is disabled (default).
    if (allowPty && this._ptyModule === null) {
      try {
        // eslint-disable-next-line node/no-unsupported-features/es-syntax
        const ptyModule = await import('node-pty').catch(() => null);
        this._ptyModule = (ptyModule?.default || ptyModule || null) as IPty | null;
      } catch {
        this._ptyModule = null;
      }
    }

    return new Promise<CommandResult>((resolve, reject) => {
      logger.debug('Executing cursor-cli command', {
        command: this.cursorPath,
        args: this.formatArgsForLogging(args),
        cwd,
      });

      // Wrapper to ensure semaphore is released on rejection
      const safeReject = (error: unknown): void => {
        if (!completed) {
          this.semaphore.release();
        }
        reject(error);
      };

      let stdout = '';
      let stderr = '';
      let outputSize = 0;
      const commandStartTime = Date.now();
      let lastOutputTime = commandStartTime;
      let hasReceivedOutput = false;
      // Used to make heartbeat logs more intuitive by showing deltas since last heartbeat.
      let lastHeartbeatTime = commandStartTime;
      let lastHeartbeatStdoutLength = 0;
      let lastHeartbeatStderrLength = 0;
      let completed = false;
      let heartbeatInterval: NodeJS.Timeout | null = null;
      let safetyTimeoutId: NodeJS.Timeout | null = null;
      let killEscalationTimer: NodeJS.Timeout | null = null;
      // Whether the spawned child is expected to be a process-group leader.
      // We only attempt process-group kills when we know that is true (regular spawn + detached on POSIX).
      let spawnedAsDetachedProcessGroupLeader = false;

      // Try to use a pseudo-TTY so cursor behaves like an interactive session
      let child: ChildProcess | IPtyProcess | undefined;
      let usePty = false;

      const clearKillEscalationTimer = (): void => {
        if (killEscalationTimer) {
          clearTimeout(killEscalationTimer);
          killEscalationTimer = null;
        }
      };

      /**
       * Best-effort termination of cursor-cli and any of its children.
       *
       * Why process-group kill?
       * - `cursor` may spawn subprocesses. Killing only the direct child can leave descendants running (orphaned),
       *   which can later spike CPU without any additional app-level logs.
       * - On POSIX, if we spawn with `detached: true`, the child becomes a process-group leader. We can then
       *   `process.kill(-pid, signal)` to signal the whole group.
       *
       * Notes:
       * - We still call `child.kill(signal)` as a fallback.
       * - For PTY mode, we do NOT assume the child is a process-group leader.
       */
      const terminateCursorCli = (reason: string): void => {
        const targetChild = child;
        if (!targetChild) return;

        // Both ChildProcess and IPtyProcess expose a numeric pid.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pid = (targetChild as any).pid;
        const safePid = typeof pid === 'number' && Number.isFinite(pid) ? pid : null;
        logger.warn('Terminating cursor-cli process', {
          reason,
          pid: safePid,
          usePty,
          processGroupKillEnabled:
            spawnedAsDetachedProcessGroupLeader && process.platform !== 'win32' && !usePty,
        });

        const trySignal = (signal: NodeJS.Signals): void => {
          // 1) Try process-group kill when safe
          if (
            !usePty &&
            spawnedAsDetachedProcessGroupLeader &&
            process.platform !== 'win32' &&
            safePid &&
            safePid > 0
          ) {
            try {
              // Negative PID targets the process group on POSIX.
              process.kill(-safePid, signal);
            } catch {
              // Ignore (ESRCH, EPERM, etc.)
            }
          }

          // 2) Always try to signal the direct child too
          try {
            if ('kill' in targetChild && typeof targetChild.kill === 'function') {
              targetChild.kill(signal);
            }
          } catch {
            // Ignore
          }
        };

        // Clear any existing escalation timer (avoid stacking timers)
        clearKillEscalationTimer();

        // First attempt: graceful
        trySignal('SIGTERM');

        // Escalate to SIGKILL
        killEscalationTimer = setTimeout(() => {
          trySignal('SIGKILL');
        }, 1000);
      };

      // Set environment with LOG_LEVEL=debug for verbose cursor-agent output
      // Force HOME=/root to ensure cursor-cli reads from /root/.cursor/mcp.json
      // instead of project-level .cursor/mcp.json (which may have outdated config)
      const env = {
        ...process.env,
        LOG_LEVEL: 'debug',
        HOME: '/root',
      };

      if (allowPty && this._ptyModule) {
        try {
          child = this._ptyModule.spawn(this.cursorPath, [...args], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd,
            env,
          });
          usePty = true;
          logger.info('Using PTY for cursor-cli execution', {
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
            cwd,
          });
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.warn('Failed to start cursor-cli with PTY, falling back to spawn', {
            error: errorMessage,
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
            cwd,
          });
        }
      }

      // Fallback to regular spawn
      if (!usePty) {
        child = spawn(this.cursorPath, [...args], {
          cwd,
          // Important: leave stdin closed. cursor-agent runs headless via argv and can hang
          // if stdin is left open as a pipe in some environments.
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          env,
          // Spawn as a process-group leader on POSIX so we can reliably terminate the entire process group
          // (cursor-cli + any subprocesses it spawns) on timeouts.
          detached: process.platform !== 'win32',
        });
        spawnedAsDetachedProcessGroupLeader = process.platform !== 'win32';
        logger.info('Using regular spawn for cursor-cli execution', {
          command: this.cursorPath,
          args: this.formatArgsForLogging(args),
          cwd,
        });
      }

      if (!child) {
        safeReject(new Error('Failed to create child process'));
        return;
      }

      // Set timeout (ensure it's a valid positive number)
      const validTimeout = isNaN(timeout) || timeout <= 0 ? this.timeout : timeout;

      // Safety mechanism: Ensure semaphore is released even if handleExit never fires
      // This protects against edge cases where the process exits but events don't fire
      // Set to timeout + 5 seconds to ensure it fires after the main timeout
      safetyTimeoutId = setTimeout(() => {
        if (!completed) {
          logger.error('cursor-cli command safety timeout - forcing cleanup', {
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
            cwd,
            timeout: `${validTimeout + 5000}ms`,
          });
          terminateCursorCli('safety timeout (no exit event observed)');
          completed = true;
          clearTimeout(timeoutId);
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          // Force release semaphore as a safety measure
          this.semaphore.release();
          // Resolve with error result to prevent hanging
          resolve({
            success: false,
            exitCode: null,
            stdout: stdout.trim(),
            stderr: (
              stderr.trim() || 'Command did not exit normally - safety timeout triggered'
            ).trim(),
          });
        } else {
          // Already completed, just clear this timeout (shouldn't happen, but safety check)
          if (safetyTimeoutId) {
            clearTimeout(safetyTimeoutId);
          }
        }
      }, validTimeout + 5000); // 5 seconds after main timeout

      const timeoutId = setTimeout(() => {
        if (completed) return;

        logger.error('cursor-cli command timeout', {
          command: this.cursorPath,
          args: this.formatArgsForLogging(args),
          cwd,
          timeout: `${validTimeout}ms`,
          hasReceivedOutput,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          lastOutputTime: lastOutputTime ? new Date(lastOutputTime).toISOString() : null,
        });

        terminateCursorCli(`hard timeout (${validTimeout}ms)`);

        completed = true;
        clearTimeout(timeoutId);
        if (safetyTimeoutId) {
          clearTimeout(safetyTimeoutId); // Clear safety timeout since we're handling it
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null; // Clear reference to prevent memory leaks
        }
        // Force release semaphore to prevent semaphore leak on timeout
        this.semaphore.release();
        const timeoutError: CommandError = new Error(`Command timeout after ${validTimeout}ms`);
        // Attach partial output to error so it can be retrieved by caller
        timeoutError.stdout = stdout;
        timeoutError.stderr = stderr;
        timeoutError.exitCode = null;
        safeReject(timeoutError);
      }, validTimeout);

      // Log heartbeat every 30 seconds to show process is still running
      heartbeatInterval = setInterval(() => {
        // Don't log if command already completed (race condition protection)
        // Check completed flag TWICE: once at start, once before logging
        // This prevents race conditions where handleExit is called mid-execution
        if (completed) {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          return;
        }

        const now = Date.now();
        const timeSinceLastOutput = now - lastOutputTime;
        const elapsed = now - commandStartTime;
        const timeSinceLastHeartbeat = now - lastHeartbeatTime;

        // Double-check completed flag right before logging to prevent
        // logging after handleExit has been called but before this callback returns
        if (completed) {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          return;
        }

        // Capture current state atomically to avoid race conditions
        const currentHasReceivedOutput = hasReceivedOutput;
        const currentStdoutLength = stdout.length;
        const currentStderrLength = stderr.length;

        const stdoutDeltaSinceHeartbeat = Math.max(
          0,
          currentStdoutLength - lastHeartbeatStdoutLength
        );
        const stderrDeltaSinceHeartbeat = Math.max(
          0,
          currentStderrLength - lastHeartbeatStderrLength
        );
        const outputSinceLastHeartbeat =
          stdoutDeltaSinceHeartbeat > 0 || stderrDeltaSinceHeartbeat > 0;

        // Hard timeout (wall-clock). Use the same validation logic as the timer.
        const hardTimeoutMs = isNaN(timeout) || timeout <= 0 ? this.timeout : timeout;
        const idleTimeoutMs = idleTimeout;
        const hardTimeoutRemainingMs = Math.max(0, hardTimeoutMs - elapsed);
        const idleTimeoutRemainingMs = Math.max(0, idleTimeoutMs - timeSinceLastOutput);
        const idleTimeoutArmed = currentHasReceivedOutput;

        logger.info('cursor-cli command heartbeat', {
          command: this.cursorPath,
          args: this.formatArgsForLogging(args),
          hasReceivedOutput: currentHasReceivedOutput,
          stdoutLength: currentStdoutLength,
          stderrLength: currentStderrLength,
          outputSinceLastHeartbeat,
          stdoutDeltaSinceHeartbeat,
          stderrDeltaSinceHeartbeat,
          timeSinceLastOutput: `${timeSinceLastOutput}ms`,
          elapsed: `${elapsed}ms`,
          idleTimeoutMs,
          idleTimeoutRemainingMs,
          idleTimeoutArmed,
          hardTimeoutMs,
          hardTimeoutRemainingMs,
          timeSinceLastHeartbeat: `${timeSinceLastHeartbeat}ms`,
          usePty,
        });

        // Update heartbeat baseline after logging so deltas are "since last heartbeat"
        lastHeartbeatTime = now;
        lastHeartbeatStdoutLength = currentStdoutLength;
        lastHeartbeatStderrLength = currentStderrLength;

        // Idle timeout is only meaningful once we've actually observed output.
        // In headless `cursor --print` mode, stdout/stderr may be buffered until exit, so "no output yet"
        // does NOT necessarily mean the process is hung.
        //
        // If we've had no output for longer than idleTimeout AFTER output has started, fail fast.
        if (!completed && currentHasReceivedOutput && timeSinceLastOutput > idleTimeout) {
          logger.error('cursor-cli idle timeout reached', {
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
            cwd,
            idleTimeout: `${idleTimeout}ms`,
            hasReceivedOutput,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          terminateCursorCli(`idle timeout (no output for ${idleTimeout}ms)`);

          completed = true;
          clearTimeout(timeoutId);
          clearTimeout(safetyTimeoutId); // Clear safety timeout since we're handling it
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null; // Clear reference to prevent memory leaks
          }
          // Force release semaphore to prevent semaphore leak on idle timeout
          this.semaphore.release();
          const idleError: CommandError = new Error(
            `No output from cursor-cli for ${idleTimeout}ms`
          );
          // Attach partial output to error so it can be retrieved by caller
          idleError.stdout = stdout;
          idleError.stderr = stderr;
          idleError.exitCode = null;
          safeReject(idleError);
        }
      }, 30000);

      // Track if we've already responded to SSH prompt to avoid multiple responses
      let sshPromptResponded = false;

      const handleData = (data: string | Buffer): void => {
        const chunk = typeof data === 'string' ? data : data.toString();
        outputSize += Buffer.byteLength(chunk);
        lastOutputTime = Date.now();
        if (!hasReceivedOutput) {
          logger.info('cursor-cli first output detected', {
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
            cwd,
            usePty,
          });
        }
        hasReceivedOutput = true;

        // Check for SSH host key verification prompt and auto-respond
        // This handles cases where known_hosts wasn't properly configured
        if (
          usePty &&
          !sshPromptResponded &&
          (chunk.includes('Are you sure you want to continue connecting') ||
            chunk.includes('authenticity of host') ||
            chunk.includes('ED25519 key fingerprint') ||
            chunk.includes('This key is not known'))
        ) {
          sshPromptResponded = true;
          logger.info('Detected SSH host key prompt, auto-responding "yes"', {
            command: this.cursorPath,
            args: this.formatArgsForLogging(args),
          });
          // Send "yes" followed by newline to PTY
          try {
            if ('write' in child && typeof child.write === 'function') {
              child.write('yes\n');
            }
          } catch (error) {
            logger.warn('Failed to write to PTY for SSH prompt response', {
              error: getErrorMessage(error),
            });
          }
        }

        // Log output chunks in real-time (truncate for logging)
        const logChunk = chunk.length > 500 ? chunk.substring(0, 500) + '...' : chunk;
        logger.info('cursor-cli stdout chunk', {
          command: this.cursorPath,
          args: this.formatArgsForLogging(args),
          chunkLength: chunk.length,
          chunkPreview: logChunk.replace(/\n/g, '\\n'),
          totalStdoutLength: stdout.length + chunk.length,
        });

        if (outputSize > this.maxOutputSize) {
          terminateCursorCli(`output size exceeded (${this.maxOutputSize} bytes)`);
          completed = true;
          clearTimeout(timeoutId);
          clearTimeout(safetyTimeoutId); // Clear safety timeout since we're handling it
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null; // Clear reference to prevent memory leaks
          }
          safeReject(new Error(`Output size exceeded limit: ${this.maxOutputSize} bytes`));
          return;
        }

        stdout += chunk;
      };

      // PTY: single data stream
      if ('onData' in child && typeof child.onData === 'function') {
        child.onData(handleData);
      } else if ('stdout' in child && child.stdout) {
        // Fallback: regular child process
        child.stdout.on('data', (data: Buffer) => handleData(data));
        if ('stderr' in child && child.stderr) {
          child.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString();
            lastOutputTime = Date.now();
            hasReceivedOutput = true;

            const logChunk = chunk.length > 500 ? chunk.substring(0, 500) + '...' : chunk;
            logger.warn('cursor-cli stderr chunk', {
              command: this.cursorPath,
              args: this.formatArgsForLogging(args),
              chunkLength: chunk.length,
              chunkPreview: logChunk.replace(/\n/g, '\\n'),
              totalStderrLength: stderr.length + chunk.length,
            });

            stderr += chunk;
          });
        }
      }

      const handleExit = (code: number | null): void => {
        if (completed) return;

        // Set completed flag FIRST to prevent heartbeat from logging
        // This must happen before clearing the interval to prevent race conditions
        completed = true;

        clearTimeout(timeoutId);
        clearTimeout(safetyTimeoutId); // Clear safety timeout since process exited normally
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null; // Clear reference to prevent memory leaks
        }
        clearKillEscalationTimer();

        // For PTY processes, wait a short time to allow buffered output to flush
        // This ensures we capture all output before resolving
        const flushDelay = usePty ? 100 : 0; // 100ms delay for PTY to flush buffered data

        const finalizeResult = (): void => {
          const result: CommandResult = {
            success: code === 0,
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          };

          logger.info('cursor-cli command process closed', {
            args: this.formatArgsForLogging(args),
            exitCode: code,
            hasReceivedOutput,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
            usePty,
          });

          if (code === 0) {
            logger.info('cursor-cli command completed successfully', {
              args: this.formatArgsForLogging(args),
            });
          } else {
            logger.warn('cursor-cli command failed', {
              args: this.formatArgsForLogging(args),
              exitCode: code,
              stderr,
            });
          }

          // Always resolve with result, even on failure, so caller can access stdout/stderr
          // Release semaphore before resolving
          this.semaphore.release();
          resolve(result);
        };

        if (flushDelay > 0) {
          // Wait for buffered PTY data to flush before finalizing
          setTimeout(finalizeResult, flushDelay);
        } else {
          finalizeResult();
        }
      };

      if ('onExit' in child && typeof child.onExit === 'function') {
        // PTY exit event
        child.onExit(({ exitCode }: { exitCode: number }) => {
          handleExit(exitCode);
        });
      } else if ('on' in child && typeof child.on === 'function') {
        // Regular child process
        child.on('close', handleExit);
        child.on('error', (error: Error) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutId);
          clearTimeout(safetyTimeoutId); // Clear safety timeout since we're handling it
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null; // Clear reference to prevent memory leaks
          }
          logger.error('cursor-cli command error', {
            args: this.formatArgsForLogging(args),
            error: error.message,
            hasReceivedOutput,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          safeReject(error);
        });
      }
    });
  }

  /**
   * Generate tests (TDD Red phase)
   * @param requirements - Test requirements
   * @param targetPath - Target application path
   * @returns Promise resolving to generation result
   */
  async generateTests(
    requirements: GenerationRequirements,
    targetPath: string
  ): Promise<GenerationResult> {
    logger.info('Generating tests (TDD Red phase)', { targetPath });

    // Build cursor command to generate tests
    // Use --model auto for consistent model selection (same as main execution)
    const prompt = `Generate test cases for: ${JSON.stringify(requirements)}`;
    const args: string[] = ['--model', 'auto', '--print', '--force', prompt];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'red',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Test generation failed', { error: errorMessage });
      return {
        success: false,
        phase: 'red',
        error: errorMessage,
      };
    }
  }

  /**
   * Generate implementation (TDD Green phase)
   * @param requirements - Implementation requirements
   * @param targetPath - Target application path
   * @returns Promise resolving to generation result
   */
  async generateImplementation(
    requirements: GenerationRequirements,
    targetPath: string
  ): Promise<GenerationResult> {
    logger.info('Generating implementation (TDD Green phase)', { targetPath });

    // Use --model auto for consistent model selection (same as main execution)
    const prompt = `Implement code to satisfy: ${JSON.stringify(requirements)}`;
    const args: string[] = ['--model', 'auto', '--print', '--force', prompt];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'green',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Implementation generation failed', { error: errorMessage });
      return {
        success: false,
        phase: 'green',
        error: errorMessage,
      };
    }
  }

  /**
   * Refactor code (TDD Refactor phase)
   * @param requirements - Refactoring requirements
   * @param targetPath - Target application path
   * @returns Promise resolving to refactoring result
   */
  async refactorCode(
    requirements: GenerationRequirements,
    targetPath: string
  ): Promise<GenerationResult> {
    logger.info('Refactoring code (TDD Refactor phase)', { targetPath });

    // Use --model auto for consistent model selection (same as main execution)
    const prompt = `Refactor code: ${JSON.stringify(requirements)}`;
    const args: string[] = ['--model', 'auto', '--print', '--force', prompt];

    try {
      const result = await this.executeCommand(args, { cwd: targetPath });

      return {
        success: true,
        phase: 'refactor',
        output: result.stdout,
        files: this.extractFilesFromOutput(result.stdout),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Refactoring failed', { error: errorMessage });
      return {
        success: false,
        phase: 'refactor',
        error: errorMessage,
      };
    }
  }

  /**
   * Extract file paths from cursor output
   * @param output - Command output
   * @returns Array of file paths
   */
  extractFilesFromOutput(output: string): readonly string[] {
    // Basic implementation - enhance based on actual cursor-cli output format
    const filePattern = /(?:created|modified|updated):\s*(.+)/gi;
    const files: string[] = []; // Mutable during construction
    let match: RegExpExecArray | null;

    while ((match = filePattern.exec(output)) !== null) {
      files.push(match[1].trim());
    }

    return files as readonly string[]; // Return as readonly
  }
}
