export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  // Match all test files: *.test.ts, *.test.js, *.spec.ts
  testMatch: ['**/tests/**/*.test.{js,ts}', '**/tests/**/*.spec.{js,ts}'],
  // Coverage collection: include all source files except index.ts
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/index.{js,ts}',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Coverage thresholds: conservative values to start
  // These will fail builds if coverage drops below these levels
  // Set to current coverage levels - can be raised as more tests are added
  coverageThreshold: {
    global: {
      lines: 35,
      branches: 30,
      functions: 40,
      statements: 35,
    },
  },
  // Test timeout: 10 seconds for integration tests
  // Unit tests should complete much faster, but this accommodates slower integration tests
  testTimeout: 10000,
  verbose: true,
};
