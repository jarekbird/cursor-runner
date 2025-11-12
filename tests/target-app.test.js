import { TargetAppRunner } from '../src/target-app.js';

describe('TargetAppRunner', () => {
  let targetAppRunner;

  beforeEach(() => {
    targetAppRunner = new TargetAppRunner();
  });

  describe('extractTestResults', () => {
    it('should extract RSpec test results', () => {
      const output = '10 examples, 2 failures';
      const results = targetAppRunner.extractTestResults(output, false);

      expect(results.total).toBe(10);
      expect(results.failed).toBe(2);
      expect(results.passed).toBe(8);
    });

    it('should extract Jest test results', () => {
      const output = '5 passed';
      const results = targetAppRunner.extractTestResults(output, true);

      expect(results.passed).toBe(5);
    });

    it('should handle empty output', () => {
      const results = targetAppRunner.extractTestResults('', true);

      expect(results.total).toBe(0);
      expect(results.passed).toBe(0);
      expect(results.failed).toBe(0);
    });
  });
});
