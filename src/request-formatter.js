import { logger } from './logger.js';

/**
 * RequestFormatter - Formats requests and responses for cursor-cli commands
 *
 * Provides standardized request/response formatting for communication
 * between jarek-va and cursor-runner.
 */
export class RequestFormatter {
  /**
   * Format code generation request from jarek-va
   * @param {Object} rawRequest - Raw request from jarek-va
   * @returns {Object} Formatted request for cursor-cli
   */
  static formatCodeGenerationRequest(rawRequest) {
    try {
      // Validate required fields
      if (!rawRequest.phase) {
        throw new Error('Missing required field: phase');
      }

      if (!rawRequest.requirements) {
        throw new Error('Missing required field: requirements');
      }

      // Format request
      const formatted = {
        id: rawRequest.id || this.generateRequestId(),
        phase: rawRequest.phase.toLowerCase(),
        requirements: this.formatRequirements(rawRequest.requirements),
        targetPath: rawRequest.targetPath || process.env.TARGET_APP_PATH,
        metadata: {
          timestamp: new Date().toISOString(),
          source: rawRequest.source || 'jarek-va',
          conversationId: rawRequest.conversation_id || rawRequest.conversationId,
        },
      };

      // Validate phase
      const validPhases = ['red', 'green', 'refactor', 'validate'];
      if (!validPhases.includes(formatted.phase)) {
        throw new Error(
          `Invalid phase: ${formatted.phase}. Must be one of: ${validPhases.join(', ')}`
        );
      }

      logger.debug('Formatted code generation request', {
        requestId: formatted.id,
        phase: formatted.phase,
      });

      return formatted;
    } catch (error) {
      logger.error('Failed to format code generation request', {
        error: error.message,
        rawRequest,
      });
      throw error;
    }
  }

  /**
   * Format requirements object
   * @param {Object|string} requirements - Requirements from request
   * @returns {Object} Formatted requirements
   */
  static formatRequirements(requirements) {
    if (typeof requirements === 'string') {
      return {
        description: requirements,
        type: 'general',
      };
    }

    if (typeof requirements === 'object' && requirements !== null) {
      // Prioritize snake_case over camelCase for consistency
      const testFramework = requirements.test_framework || requirements.testFramework || 'rspec';

      return {
        ...requirements, // Spread first to include all fields
        // Then override with formatted values
        description:
          requirements.description || requirements.desc || requirements.description || '',
        type: requirements.type || 'general',
        testFramework, // Use the resolved value (prioritize snake_case)
        test_framework: testFramework, // Also include snake_case version
        language: requirements.language || 'ruby',
        framework: requirements.framework || 'rails',
      };
    }

    throw new Error('Invalid requirements format');
  }

  /**
   * Format code generation response for jarek-va
   * @param {Object} result - Result from cursor-cli execution
   * @param {Object} request - Original request
   * @returns {Object} Formatted response
   */
  static formatCodeGenerationResponse(result, request) {
    try {
      const response = {
        success: result.success !== false,
        requestId: request.id,
        phase: request.phase,
        timestamp: new Date().toISOString(),
      };

      if (result.success) {
        response.message = this.generateSuccessMessage(result, request.phase);
        response.data = {
          output: result.output || '',
          files: result.files || [],
          phase: result.phase || request.phase,
        };

        // Add phase-specific data
        if (request.phase === 'validate' && result.passed) {
          response.data.testResults = result.passed;
        }
      } else {
        response.error = result.error || 'Unknown error occurred';
        response.message = this.generateErrorMessage(result.error, request.phase);
        response.data = {
          phase: request.phase,
        };
      }

      logger.debug('Formatted code generation response', {
        requestId: request.id,
        success: response.success,
        phase: request.phase,
      });

      return response;
    } catch (error) {
      logger.error('Failed to format code generation response', {
        error: error.message,
        result,
        request,
      });

      // Return error response
      return {
        success: false,
        requestId: request?.id || 'unknown',
        phase: request?.phase || 'unknown',
        timestamp: new Date().toISOString(),
        error: 'Failed to format response',
        message: 'An error occurred while formatting the response',
      };
    }
  }

  /**
   * Format error response for jarek-va
   * @param {Error} error - Error object
   * @param {Object} request - Original request (optional)
   * @returns {Object} Formatted error response
   */
  static formatErrorResponse(error, request = null) {
    const response = {
      success: false,
      requestId: request?.id || 'unknown',
      phase: request?.phase || 'unknown',
      timestamp: new Date().toISOString(),
      error: error.message || 'Unknown error',
      message: this.generateErrorMessage(error.message, request?.phase),
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
      response.stack = error.stack;
    }

    logger.error('Formatted error response', {
      requestId: response.requestId,
      error: error.message,
    });

    return response;
  }

  /**
   * Generate success message based on phase
   * @param {Object} result - Result object
   * @param {string} phase - TDD phase
   * @returns {string} Success message
   */
  static generateSuccessMessage(result, phase) {
    const messages = {
      red: `Successfully generated test cases. ${result.files?.length || 0} file(s) created.`,
      green: `Successfully generated implementation code. ${result.files?.length || 0} file(s) created.`,
      refactor: `Successfully refactored code. ${result.files?.length || 0} file(s) modified.`,
      validate: result.passed
        ? `All tests passed! ${result.passed.passed || 0}/${result.passed.total || 0} tests passed.`
        : 'Tests executed successfully.',
    };

    return messages[phase] || 'Operation completed successfully.';
  }

  /**
   * Generate error message based on phase
   * @param {string} error - Error message
   * @param {string} phase - TDD phase
   * @returns {string} Error message
   */
  static generateErrorMessage(error, phase) {
    const phaseNames = {
      red: 'test generation',
      green: 'implementation generation',
      refactor: 'refactoring',
      validate: 'test validation',
    };

    const phaseName = phaseNames[phase] || 'operation';

    return `Failed during ${phaseName}: ${error}`;
  }

  /**
   * Generate unique request ID
   * @returns {string} Request ID
   */
  static generateRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate request structure
   * @param {Object} request - Request to validate
   * @returns {Object} Validation result
   */
  static validateRequest(request) {
    const errors = [];

    if (!request) {
      errors.push('Request is required');
      return { valid: false, errors };
    }

    if (!request.phase) {
      errors.push('phase is required');
    } else {
      const validPhases = ['red', 'green', 'refactor', 'validate'];
      if (!validPhases.includes(request.phase.toLowerCase())) {
        errors.push(`Invalid phase: ${request.phase}. Must be one of: ${validPhases.join(', ')}`);
      }
    }

    if (!request.requirements) {
      errors.push('requirements is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
