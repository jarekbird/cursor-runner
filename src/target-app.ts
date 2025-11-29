import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { existsSync as defaultExistsSync } from 'fs';

/**
 * Options for TargetAppRunner constructor
 */
interface TargetAppRunnerOptions {
  fsExistsSync?: (path: string) => boolean;
}

/**
 * Options for executeCommand method
 */
interface ExecuteCommandOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Result of executeCommand method
 */
interface ExecuteCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Test statistics extracted from output
 */
interface TestStatistics {
  passed: number;
  failed: number;
  total: number;
  success: boolean;
}

/**
 * Result of runTests method
 */
interface TestResult {
  success: boolean;
  exitCode?: number | null;
  output?: string;
  error?: string;
  passed?: TestStatistics;
}

/**
 * Supported target application types
 */
export type TargetAppType = 'rails' | 'node';

/**
 * TargetAppRunner - Runs tests and commands in target applications
 *
 * Handles execution of tests and other commands in the target application
 * being developed by cursor (e.g., jarek-va Rails app).
 */
export class TargetAppRunner {
  readonly targetAppPath: string;
  readonly targetAppType: TargetAppType;
  readonly timeout: number;
  readonly fsExistsSync: (path: string) => boolean;

  /**
   * @param options - Optional configuration
   * @param options.fsExistsSync - Optional injected fs.existsSync implementation (for testing)
   */
  constructor(options: TargetAppRunnerOptions = {}) {
    const { fsExistsSync } = options;

    // TARGET_APP_PATH is optional - if not set, TargetAppRunner will not be used
    this.targetAppPath = process.env.TARGET_APP_PATH || '../cursor';
    const appType = (process.env.TARGET_APP_TYPE || 'rails') as TargetAppType;
    if (appType !== 'rails' && appType !== 'node') {
      throw new Error(`Invalid target app type: ${appType}. Must be 'rails' or 'node'`);
    }
    this.targetAppType = appType;
    this.timeout = parseInt(process.env.TARGET_APP_TIMEOUT || '600000', 10); // 10 minutes default
    this.fsExistsSync = fsExistsSync || defaultExistsSync;
  }

  /**
   * Validate target application exists
   * @returns Promise resolving to true if valid
   */
  async validate(): Promise<boolean> {
    // If TARGET_APP_PATH is not set, skip validation (TargetAppRunner is optional)
    if (!this.targetAppPath) {
      logger.info('Target application path not configured, skipping validation');
      return true;
    }

    if (!this.fsExistsSync(this.targetAppPath)) {
      throw new Error(`Target application path does not exist: ${this.targetAppPath}`);
    }

    logger.info('Target application validated', {
      path: this.targetAppPath,
      type: this.targetAppType,
    });

    return true;
  }

  /**
   * Run tests in target application
   * @param targetPath - Optional override for target path
   * @returns Promise resolving to test results
   */
  async runTests(targetPath: string | null = null): Promise<TestResult> {
    const appPath = targetPath || this.targetAppPath;

    logger.info('Running tests in target application', {
      path: appPath,
      type: this.targetAppType,
    });

    try {
      let command: string;
      let args: string[];

      switch (this.targetAppType) {
        case 'rails':
          command = 'bundle';
          args = ['exec', 'rspec'];
          break;
        case 'node':
          command = 'npm';
          args = ['test'];
          break;
        default:
          throw new Error(`Unsupported target app type: ${this.targetAppType}`);
      }

      const result = await this.executeCommand(command, args, { cwd: appPath });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        output: result.stdout,
        error: result.stderr,
        passed: this.extractTestResults(result.stdout, result.exitCode === 0),
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Test execution failed', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a command in the target application
   * @param command - Command to execute
   * @param args - Command arguments
   * @param options - Execution options
   * @returns Promise resolving to command result
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    options: ExecuteCommandOptions = {}
  ): Promise<ExecuteCommandResult> {
    return new Promise((resolve, reject) => {
      const cwd = options.cwd || this.targetAppPath;
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing command in target app', {
        command,
        args,
        cwd,
      });

      const child: ChildProcess = spawn(command, [...args], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      // Set timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timeout after ${timeout}ms`));
      }, timeout);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      // Collect stderr
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      // Handle process completion
      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        const result: ExecuteCommandResult = {
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        resolve(result);
      });

      // Handle process errors
      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        logger.error('Command execution error', { command, error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Extract test results from output
   * @param output - Test output
   * @param success - Whether tests passed
   * @returns Test statistics
   */
  extractTestResults(output: string, success: boolean): TestStatistics {
    // Basic implementation - enhance based on test framework output format
    const results: TestStatistics = {
      passed: 0,
      failed: 0,
      total: 0,
      success,
    };

    // Try to extract RSpec results
    const rspecMatch = output.match(/(\d+)\s+examples?,\s*(\d+)\s+failures?/);
    if (rspecMatch) {
      results.total = parseInt(rspecMatch[1], 10);
      results.failed = parseInt(rspecMatch[2], 10);
      results.passed = results.total - results.failed;
    }

    // Try to extract Jest results
    const jestMatch = output.match(/(\d+)\s+passed/);
    if (jestMatch) {
      results.passed = parseInt(jestMatch[1], 10);
    }

    return results;
  }
}
