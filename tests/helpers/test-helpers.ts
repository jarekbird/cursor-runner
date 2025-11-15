/**
 * Test helpers and utilities
 */

export interface MockRequest {
  id?: string;
  phase: string;
  requirements: {
    description: string;
    type?: string;
    [key: string]: any;
  };
  targetPath?: string;
  [key: string]: any;
}

export interface MockResponse {
  success: boolean;
  phase?: string;
  output?: string;
  files?: string[];
  [key: string]: any;
}

export const createMockRequest = (overrides: Partial<MockRequest> = {}): MockRequest => {
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

export const createMockResponse = (overrides: Partial<MockResponse> = {}): MockResponse => {
  return {
    success: true,
    phase: 'red',
    output: 'Mock output',
    files: [],
    ...overrides,
  };
};
