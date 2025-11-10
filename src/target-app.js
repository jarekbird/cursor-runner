import { spawn } from 'child_process';
import { logger } from './logger.js';
import path from 'path';
import { existsSync } from 'fs';

/**
 * TargetAppRunner - Runs tests and commands in target applications
 * 
 * Handles execution of tests and other commands in the target application
 * being developed by cursor (e.g., jarek-va Rails app).
 */
export class TargetAppRunner {
  constructor() {
    this.targetAppPath = process.env.TARGET_APP_PATH || '../jarek-va';
    this.targetAppType = process.env.TARGET_APP_TYPE || 'rails';
    this.timeout = parseInt(process.env.TARGET_APP_TIMEOUT || '600000', 10); // 10 minutes default
  }

  /**
   * Validate target application exists
   * @returns {Promise<boolean>}
   */
  async validate() {
    if (!existsSync(this.targetAppPath)) {
      throw new Error(`Target application path does not exist: ${this.targetAppPath}`);
    }

    logger.info('Target application validated', { 
      path: this.targetAppPath,
      type: this.targetAppType 
    });
    
    return true;
  }

  /**
   * Run tests in target application
   * @param {string} targetPath - Optional override for target path
   * @returns {Promise<Object>} Test results
   */
  async runTests(targetPath = null) {
    const appPath = targetPath || this.targetAppPath;
    
    logger.info('Running tests in target application', { 
      path: appPath,
      type: this.targetAppType 
    });

    try {
      let command;
      let args;

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
      logger.error('Test execution failed', { error: error.message });
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute a command in the target application
   * @param {string} command - Command to execute
   * @param {Array<string>} args - Command arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Command result
   */
  async executeCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const cwd = options.cwd || this.targetAppPath;
      const timeout = options.timeout || this.timeout;

      logger.debug('Executing command in target app', { 
        command,
        args,
        cwd 
      });

      const child = spawn(command, args, {
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
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        clearTimeout(timeoutId);

        const result = {
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };

        resolve(result);
      });

      // Handle process errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.error('Command execution error', { command, error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Extract test results from output
   * @param {string} output - Test output
   * @param {boolean} success - Whether tests passed
   * @returns {Object} Test statistics
   */
  extractTestResults(output, success) {
    // Basic implementation - enhance based on test framework output format
    const results = {
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

