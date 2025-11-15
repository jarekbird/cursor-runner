// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect } from '@jest/globals';
import { TerminalService } from '../src/terminal-service.js';

describe('TerminalService', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      const service = new TerminalService();
      expect(service.timeout).toBe(300000);
      expect(service.maxOutputSize).toBe(10485760);
      expect(service.allowedCommands).toBeDefined();
      expect(service.blockedCommands).toBeDefined();
    });
  });

  describe('validateCommandSecurity', () => {
    it('should block dangerous commands', () => {
      const service = new TerminalService();
      expect(() => {
        service.validateCommandSecurity('rm', ['-rf', '/']);
      }).toThrow('Blocked command detected: rm');
    });

    it('should allow safe commands', () => {
      const service = new TerminalService();
      expect(() => {
        service.validateCommandSecurity('git', ['status']);
      }).not.toThrow();
    });
  });
});
