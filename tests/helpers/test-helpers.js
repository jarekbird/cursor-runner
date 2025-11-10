/**
 * Test helpers and utilities
 */

export const createMockRequest = (overrides = {}) => {
  return {
    id: 'test-request-123',
    phase: 'red',
    requirements: {
      description: 'Test feature',
      type: 'service',
    },
    targetPath: '../jarek-va',
    ...overrides,
  };
};

export const createMockResponse = (overrides = {}) => {
  return {
    success: true,
    phase: 'red',
    output: 'Mock output',
    files: [],
    ...overrides,
  };
};

