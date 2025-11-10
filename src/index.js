#!/usr/bin/env node

/**
 * cursor-runner - Main entry point
 * 
 * Node.js application for cursor-cli execution and code generation workflows.
 * Integrates with jarek-va for code writing tool requests.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';
import { CursorCLI } from './cursor-cli.js';
import { TargetAppRunner } from './target-app.js';
import { Server } from './server.js';

// Load environment variables
dotenv.config();

// Get __filename for ES modules
const __filename = fileURLToPath(import.meta.url);

/**
 * Main application class
 */
class CursorRunner {
  constructor() {
    this.cursorCLI = new CursorCLI();
    this.targetAppRunner = new TargetAppRunner();
    this.server = new Server();
    this.logger = logger;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      this.logger.info('Initializing cursor-runner...');
      
      // Validate configuration
      this.validateConfig();
      
      // Test cursor-cli availability
      await this.cursorCLI.validate();
      
      // Start HTTP server
      await this.server.start();
      
      this.logger.info('cursor-runner initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize cursor-runner', { error: error.message });
      throw error;
    }
  }

  /**
   * Shutdown the application gracefully
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down cursor-runner...');
      await this.server.stop();
      this.logger.info('cursor-runner shut down successfully');
    } catch (error) {
      this.logger.error('Error during shutdown', { error: error.message });
    }
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    const required = [
      'CURSOR_CLI_PATH',
      'TARGET_APP_PATH',
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  /**
   * Execute code generation workflow
   * @param {Object} request - Code generation request from jarek-va
   * @returns {Promise<Object>} Result of code generation
   */
  async executeCodeGeneration(request) {
    try {
      this.logger.info('Executing code generation workflow', { requestId: request.id });
      
      const { phase, requirements, targetPath } = request;
      
      let result;
      
      switch (phase) {
        case 'red':
          // Generate tests first (TDD Red phase)
          result = await this.cursorCLI.generateTests(requirements, targetPath);
          break;
        case 'green':
          // Generate implementation (TDD Green phase)
          result = await this.cursorCLI.generateImplementation(requirements, targetPath);
          break;
        case 'refactor':
          // Refactor code (TDD Refactor phase)
          result = await this.cursorCLI.refactorCode(requirements, targetPath);
          break;
        case 'validate':
          // Run tests and validate
          result = await this.targetAppRunner.runTests(targetPath);
          break;
        default:
          throw new Error(`Unknown phase: ${phase}`);
      }
      
      this.logger.info('Code generation workflow completed', { 
        requestId: request.id,
        phase,
        success: result.success 
      });
      
      return result;
    } catch (error) {
      this.logger.error('Code generation workflow failed', { 
        requestId: request.id,
        error: error.message 
      });
      throw error;
    }
  }
}

// Export for use as module
export { CursorRunner };

// Run as CLI if executed directly
if (import.meta.url === `file://${__filename}`) {
  const runner = new CursorRunner();
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    await runner.shutdown();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    await runner.shutdown();
    process.exit(0);
  });
  
  runner.initialize().catch(error => {
    console.error('Failed to start cursor-runner:', error);
    process.exit(1);
  });
}

