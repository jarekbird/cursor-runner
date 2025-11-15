// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect } from '@jest/globals';
import { RequestFormatter } from '../src/request-formatter.js';

describe('RequestFormatter', () => {
  describe('formatCodeGenerationRequest', () => {
    it('should format a valid request', () => {
      const rawRequest = {
        phase: 'red',
        requirements: {
          description: 'Create user service',
          type: 'service',
        },
        targetPath: '../jarek-va',
        id: 'test-123',
      };

      const formatted = RequestFormatter.formatCodeGenerationRequest(rawRequest) as any;

      expect(formatted.id).toBe('test-123');
      expect(formatted.phase).toBe('red');
      expect(formatted.requirements.description).toBe('Create user service');
      expect(formatted.targetPath).toBe('../jarek-va');
      expect(formatted.metadata).toBeDefined();
      expect(formatted.metadata.timestamp).toBeDefined();
    });

    it('should generate request ID if not provided', () => {
      const rawRequest = {
        phase: 'green',
        requirements: { description: 'Test' },
      };

      const formatted = RequestFormatter.formatCodeGenerationRequest(rawRequest) as any;

      expect(formatted.id).toBeDefined();
      expect(formatted.id).toMatch(/^req-/);
    });

    it('should normalize phase to lowercase', () => {
      const rawRequest = {
        phase: 'RED',
        requirements: { description: 'Test' },
      };

      const formatted = RequestFormatter.formatCodeGenerationRequest(rawRequest) as any;

      expect(formatted.phase).toBe('red');
    });

    it('should throw error if phase is missing', () => {
      const rawRequest = {
        requirements: { description: 'Test' },
      } as any;

      expect(() => {
        RequestFormatter.formatCodeGenerationRequest(rawRequest);
      }).toThrow('Missing required field: phase');
    });

    it('should throw error if requirements is missing', () => {
      const rawRequest = {
        phase: 'red',
      } as any;

      expect(() => {
        RequestFormatter.formatCodeGenerationRequest(rawRequest);
      }).toThrow('Missing required field: requirements');
    });

    it('should throw error if phase is invalid', () => {
      const rawRequest = {
        phase: 'invalid',
        requirements: { description: 'Test' },
      };

      expect(() => {
        RequestFormatter.formatCodeGenerationRequest(rawRequest);
      }).toThrow('Invalid phase');
    });
  });

  describe('formatRequirements', () => {
    it('should format string requirements', () => {
      const requirements = 'Create user service';
      const formatted = RequestFormatter.formatRequirements(requirements) as any;

      expect(formatted.description).toBe('Create user service');
      expect(formatted.type).toBe('general');
    });

    it('should format object requirements', () => {
      const requirements = {
        description: 'Create user service',
        type: 'service',
        testFramework: 'rspec',
      };

      const formatted = RequestFormatter.formatRequirements(requirements) as any;

      expect(formatted.description).toBe('Create user service');
      expect(formatted.type).toBe('service');
      expect(formatted.testFramework).toBe('rspec');
    });

    it('should handle snake_case and camelCase', () => {
      const requirements = {
        description: 'Test',
        test_framework: 'rspec',
        testFramework: 'jest',
      } as any;

      const formatted = RequestFormatter.formatRequirements(requirements) as any;

      // Both should be available, but testFramework should use snake_case value
      expect(formatted.testFramework).toBe('rspec');
      expect(formatted.test_framework).toBe('rspec');
    });
  });

  describe('formatCodeGenerationResponse', () => {
    it('should format successful response', () => {
      const result = {
        success: true,
        phase: 'red',
        output: 'Generated tests',
        files: ['spec/test_spec.rb'],
      };

      const request = {
        id: 'req-123',
        phase: 'red',
      };

      const response = RequestFormatter.formatCodeGenerationResponse(result, request) as any;

      expect(response.success).toBe(true);
      expect(response.requestId).toBe('req-123');
      expect(response.phase).toBe('red');
      expect(response.message).toBeDefined();
      expect(response.data.files).toEqual(['spec/test_spec.rb']);
    });

    it('should format error response', () => {
      const result = {
        success: false,
        error: 'Test generation failed',
      };

      const request = {
        id: 'req-123',
        phase: 'red',
      };

      const response = RequestFormatter.formatCodeGenerationResponse(result, request) as any;

      expect(response.success).toBe(false);
      expect(response.error).toBe('Test generation failed');
      expect(response.message).toContain('test generation');
    });

    it('should include test results for validate phase', () => {
      const result = {
        success: true,
        passed: {
          total: 10,
          passed: 8,
          failed: 2,
        },
      };

      const request = {
        id: 'req-123',
        phase: 'validate',
      };

      const response = RequestFormatter.formatCodeGenerationResponse(result, request) as any;

      expect(response.data.testResults).toBeDefined();
      expect(response.data.testResults.total).toBe(10);
    });
  });

  describe('formatErrorResponse', () => {
    it('should format error response', () => {
      const error = new Error('Test error');
      const request = {
        id: 'req-123',
        phase: 'red',
      };

      const response = RequestFormatter.formatErrorResponse(error, request) as any;

      expect(response.success).toBe(false);
      expect(response.error).toBe('Test error');
      expect(response.requestId).toBe('req-123');
      expect(response.timestamp).toBeDefined();
    });

    it('should include stack trace in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const error = new Error('Test error');
      const response = RequestFormatter.formatErrorResponse(error) as any;

      expect(response.stack).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('validateRequest', () => {
    it('should validate a correct request', () => {
      const request = {
        phase: 'red',
        requirements: { description: 'Test' },
      };

      const validation = RequestFormatter.validateRequest(request) as any;

      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    it('should reject request without phase', () => {
      const request = {
        requirements: { description: 'Test' },
      } as any;

      const validation = RequestFormatter.validateRequest(request) as any;

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('phase is required');
    });

    it('should reject request with invalid phase', () => {
      const request = {
        phase: 'invalid',
        requirements: { description: 'Test' },
      };

      const validation = RequestFormatter.validateRequest(request) as any;

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should reject null request', () => {
      const validation = RequestFormatter.validateRequest(null as any) as any;

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Request is required');
    });
  });

  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const id1 = RequestFormatter.generateRequestId();
      const id2 = RequestFormatter.generateRequestId();

      expect(id1).toMatch(/^req-/);
      expect(id2).toMatch(/^req-/);
      expect(id1).not.toBe(id2);
    });
  });
});
