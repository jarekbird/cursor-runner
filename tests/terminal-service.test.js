import { TerminalService } from '../src/terminal-service.js';

describe('TerminalService', () => {
  describe('constructor', () => {
    it('should initialize with default timeout', () => {
      const service = new TerminalService();
      expect(service).toBeDefined();
      expect(service.timeout).toBeGreaterThan(0);
    });
  });
});
