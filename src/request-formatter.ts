import { logger } from './logger.js';
import { getErrorMessage, getErrorStack } from './error-utils.js';

/**
 * TDD Phase type
 */
export type Phase = 'red' | 'green' | 'refactor' | 'validate';

/**
 * Valid phase values as const array
 */
export const VALID_PHASES = ['red', 'green', 'refactor', 'validate'] as const;

/**
 * Type guard to check if a string is a valid Phase
 */
export function isPhase(value: string): value is Phase {
  return VALID_PHASES.includes(value as Phase);
}

/**
 * Raw request from jarek-va
 */
interface RawRequest {
  id?: string;
  phase: string;
  requirements: string | RequirementsObject;
  targetPath?: string;
  source?: string;
  conversation_id?: string;
  conversationId?: string;
}

/**
 * Requirements object structure
 */
interface RequirementsObject {
  description?: string;
  desc?: string;
  type?: string;
  test_framework?: string;
  testFramework?: string;
  language?: string;
  framework?: string;
  [key: string]: unknown;
}

/**
 * Formatted requirements
 */
interface FormattedRequirements {
  description: string;
  type: string;
  testFramework: string;
  test_framework: string;
  language: string;
  framework: string;
  [key: string]: unknown;
}

/**
 * Formatted request for cursor-cli
 */
export interface FormattedRequest {
  id: string;
  phase: Phase;
  requirements: FormattedRequirements;
  targetPath?: string;
  metadata: {
    timestamp: string;
    source: string;
    conversationId?: string;
  };
}

/**
 * Partial request (for responses that only need id and phase)
 */
interface PartialRequest {
  id: string;
  phase: Phase | string;
}

/**
 * Test results structure
 */
interface TestResults {
  total: number;
  passed: number;
  failed?: number;
}

/**
 * Result from cursor-cli execution
 */
interface ExecutionResult {
  success?: boolean;
  phase?: Phase | string;
  output?: string;
  files?: readonly string[];
  error?: string;
  passed?: TestResults;
}

/**
 * Formatted response for jarek-va
 */
interface FormattedResponse {
  success: boolean;
  requestId: string;
  phase: Phase | string;
  timestamp: string;
  message?: string;
  error?: string;
  data?: {
    output?: string;
    files?: readonly string[];
    phase?: Phase | string;
    testResults?: TestResults;
  };
  stack?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  readonly errors: readonly string[];
}

/**
 * RequestFormatter - Formats requests and responses for cursor-cli commands
 *
 * Provides standardized request/response formatting for communication
 * between jarek-va and cursor-runner.
 */
export class RequestFormatter {
  /**
   * Format code generation request from jarek-va
   * @param rawRequest - Raw request from jarek-va
   * @returns Formatted request for cursor-cli
   */
  static formatCodeGenerationRequest(rawRequest: RawRequest): FormattedRequest {
    try {
      // Validate required fields
      if (!rawRequest.phase) {
        throw new Error('Missing required field: phase');
      }

      if (!rawRequest.requirements) {
        throw new Error('Missing required field: requirements');
      }

      // Normalize and validate phase
      const normalizedPhase = rawRequest.phase.toLowerCase();
      if (!isPhase(normalizedPhase)) {
        throw new Error(
          `Invalid phase: ${rawRequest.phase}. Must be one of: ${VALID_PHASES.join(', ')}`
        );
      }

      // Format request
      const formatted: FormattedRequest = {
        id: rawRequest.id || this.generateRequestId(),
        phase: normalizedPhase,
        requirements: this.formatRequirements(rawRequest.requirements),
        targetPath: rawRequest.targetPath || process.env.TARGET_APP_PATH,
        metadata: {
          timestamp: new Date().toISOString(),
          source: rawRequest.source || 'jarek-va',
          conversationId: rawRequest.conversation_id || rawRequest.conversationId,
        },
      };

      logger.debug('Formatted code generation request', {
        requestId: formatted.id,
        phase: formatted.phase,
      });

      return formatted;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to format code generation request', {
        error: errorMessage,
        rawRequest,
      });
      throw error;
    }
  }

  /**
   * Format requirements object
   * @param requirements - Requirements from request
   * @returns Formatted requirements
   */
  static formatRequirements(requirements: string | RequirementsObject): FormattedRequirements {
    if (typeof requirements === 'string') {
      return {
        description: requirements,
        type: 'general',
        testFramework: 'rspec',
        test_framework: 'rspec',
        language: 'ruby',
        framework: 'rails',
      };
    }

    if (typeof requirements === 'object' && requirements !== null) {
      // Prioritize snake_case over camelCase for consistency
      const testFramework = requirements.test_framework || requirements.testFramework || 'rspec';

      return {
        ...requirements, // Spread first to include all fields
        // Then override with formatted values
        description: requirements.description || requirements.desc || '',
        type: requirements.type || 'general',
        testFramework, // Use the resolved value (prioritize snake_case)
        test_framework: testFramework, // Also include snake_case version
        language: requirements.language || 'ruby',
        framework: requirements.framework || 'rails',
      } as FormattedRequirements;
    }

    throw new Error('Invalid requirements format');
  }

  /**
   * Format code generation response for jarek-va
   * @param result - Result from cursor-cli execution
   * @param request - Original request
   * @returns Formatted response
   */
  static formatCodeGenerationResponse(
    result: ExecutionResult,
    request: FormattedRequest | PartialRequest
  ): FormattedResponse {
    try {
      const response: FormattedResponse = {
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
        response.message = this.generateErrorMessage(
          result.error || 'Unknown error',
          request.phase
        );
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
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to format code generation response', {
        error: errorMessage,
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
   * @param error - Error object
   * @param request - Original request (optional)
   * @returns Formatted error response
   */
  static formatErrorResponse(
    error: Error,
    request: FormattedRequest | PartialRequest | null = null
  ): FormattedResponse {
    const response: FormattedResponse = {
      success: false,
      requestId: request?.id || 'unknown',
      phase: request?.phase || 'unknown',
      timestamp: new Date().toISOString(),
      error: error.message || 'Unknown error',
      message: this.generateErrorMessage(error.message || 'Unknown error', request?.phase),
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
      response.stack = getErrorStack(error);
    }

    logger.error('Formatted error response', {
      requestId: response.requestId,
      error: error.message,
    });

    return response;
  }

  /**
   * Generate success message based on phase
   * @param result - Result object
   * @param phase - TDD phase
   * @returns Success message
   */
  static generateSuccessMessage(result: ExecutionResult, phase: Phase | string): string {
    const messages: Record<string, string> = {
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
   * @param error - Error message
   * @param phase - TDD phase
   * @returns Error message
   */
  static generateErrorMessage(error: string, phase?: Phase | string): string {
    const phaseNames: Record<string, string> = {
      red: 'test generation',
      green: 'implementation generation',
      refactor: 'refactoring',
      validate: 'test validation',
    };

    const phaseName = phase ? phaseNames[phase] || 'operation' : 'operation';

    return `Failed during ${phaseName}: ${error}`;
  }

  /**
   * Generate unique request ID
   * @returns Request ID
   */
  static generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate request structure
   * @param request - Request to validate
   * @returns Validation result
   */
  static validateRequest(request: unknown): ValidationResult {
    const errors: string[] = []; // Mutable during construction

    if (!request) {
      errors.push('Request is required');
      return { valid: false, errors };
    }

    if (typeof request !== 'object') {
      errors.push('Request must be an object');
      return { valid: false, errors };
    }

    const req = request as Partial<RawRequest>;

    if (!req.phase) {
      errors.push('phase is required');
    } else {
      if (typeof req.phase === 'string' && !isPhase(req.phase.toLowerCase())) {
        errors.push(`Invalid phase: ${req.phase}. Must be one of: ${VALID_PHASES.join(', ')}`);
      }
    }

    if (!req.requirements) {
      errors.push('requirements is required');
    }

    return {
      valid: errors.length === 0,
      errors: errors as readonly string[], // Return as readonly
    };
  }
}
