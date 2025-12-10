import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { validateGmailConfig, getGmailMcpEnabled } from '../src/system-settings.js';
import { CursorRunner } from '../src/index.js';
import { logger } from '../src/logger.js';
import { mkdirSync } from 'fs';

describe('system-settings Gmail validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('validateGmailConfig startup validation', () => {
    it('should return valid=true when all required vars are set', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      const result = validateGmailConfig();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should return valid=false when GMAIL_CLIENT_ID is missing', () => {
      delete process.env.GMAIL_CLIENT_ID;
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GMAIL_CLIENT_ID');
    });

    it('should return valid=false when GMAIL_CLIENT_SECRET is missing', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      delete process.env.GMAIL_CLIENT_SECRET;
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GMAIL_CLIENT_SECRET');
    });

    it('should return valid=false when GMAIL_REFRESH_TOKEN is missing', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      delete process.env.GMAIL_REFRESH_TOKEN;

      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('GMAIL_REFRESH_TOKEN');
    });

    it('should return valid=false and list all missing vars when none are set', () => {
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing).toHaveLength(3);
      expect(result.missing).toContain('GMAIL_CLIENT_ID');
      expect(result.missing).toContain('GMAIL_CLIENT_SECRET');
      expect(result.missing).toContain('GMAIL_REFRESH_TOKEN');
    });
  });

  describe('getGmailMcpEnabled', () => {
    it('should return false when ENABLE_GMAIL_MCP is not set', () => {
      delete process.env.ENABLE_GMAIL_MCP;
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should return false when ENABLE_GMAIL_MCP is empty string', () => {
      process.env.ENABLE_GMAIL_MCP = '';
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should return true when ENABLE_GMAIL_MCP is "true"', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';
      expect(getGmailMcpEnabled()).toBe(true);
    });

    it('should return true when ENABLE_GMAIL_MCP is "TRUE"', () => {
      process.env.ENABLE_GMAIL_MCP = 'TRUE';
      expect(getGmailMcpEnabled()).toBe(true);
    });

    it('should return true when ENABLE_GMAIL_MCP is "1"', () => {
      process.env.ENABLE_GMAIL_MCP = '1';
      expect(getGmailMcpEnabled()).toBe(true);
    });

    it('should return true when ENABLE_GMAIL_MCP is "yes"', () => {
      process.env.ENABLE_GMAIL_MCP = 'yes';
      expect(getGmailMcpEnabled()).toBe(true);
    });

    it('should return true when ENABLE_GMAIL_MCP is "on"', () => {
      process.env.ENABLE_GMAIL_MCP = 'on';
      expect(getGmailMcpEnabled()).toBe(true);
    });

    it('should return false when ENABLE_GMAIL_MCP is "false"', () => {
      process.env.ENABLE_GMAIL_MCP = 'false';
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should return false when ENABLE_GMAIL_MCP is "0"', () => {
      process.env.ENABLE_GMAIL_MCP = '0';
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should return false when ENABLE_GMAIL_MCP is "no"', () => {
      process.env.ENABLE_GMAIL_MCP = 'no';
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should return false when ENABLE_GMAIL_MCP is "off"', () => {
      process.env.ENABLE_GMAIL_MCP = 'off';
      expect(getGmailMcpEnabled()).toBe(false);
    });

    it('should handle whitespace in ENABLE_GMAIL_MCP', () => {
      process.env.ENABLE_GMAIL_MCP = '  true  ';
      expect(getGmailMcpEnabled()).toBe(true);
    });
  });

  describe('CursorRunner.validateGmailConfig() logging', () => {
    let loggerSpy: jest.SpiedFunction<typeof logger.debug>;
    let loggerInfoSpy: jest.SpiedFunction<typeof logger.info>;
    let loggerWarnSpy: jest.SpiedFunction<typeof logger.warn>;
    let originalRepositoriesPath: string | undefined;

    beforeEach(() => {
      // Set up temp directory for repositories to avoid ENOENT errors
      originalRepositoriesPath = process.env.REPOSITORIES_PATH;
      const tempReposPath = '/tmp/test-repositories';
      process.env.REPOSITORIES_PATH = tempReposPath;
      try {
        mkdirSync(tempReposPath, { recursive: true });
      } catch {
        // Directory might already exist, ignore
      }

      loggerSpy = jest.spyOn(logger, 'debug');
      loggerInfoSpy = jest.spyOn(logger, 'info');
      loggerWarnSpy = jest.spyOn(logger, 'warn');
    });

    afterEach(() => {
      if (originalRepositoriesPath) {
        process.env.REPOSITORIES_PATH = originalRepositoriesPath;
      } else {
        delete process.env.REPOSITORIES_PATH;
      }

      loggerSpy.mockRestore();
      loggerInfoSpy.mockRestore();
      loggerWarnSpy.mockRestore();
    });

    it('should log debug when Gmail MCP is disabled', () => {
      delete process.env.ENABLE_GMAIL_MCP;
      const runner = new CursorRunner();
      runner.validateGmailConfig();

      // Check that debug was called with Gmail MCP disabled message
      const debugCalls = loggerSpy.mock.calls;
      const hasGmailDisabledMessage = debugCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP is disabled');
      });
      expect(hasGmailDisabledMessage).toBe(true);
      
      // Check that info/warn were not called with Gmail-related messages
      const infoCalls = loggerInfoSpy.mock.calls;
      const hasGmailInfoMessage = infoCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP');
      });
      expect(hasGmailInfoMessage).toBe(false);
      
      const warnCalls = loggerWarnSpy.mock.calls;
      const hasGmailWarnMessage = warnCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP');
      });
      expect(hasGmailWarnMessage).toBe(false);
    });

    it('should log info when Gmail MCP is enabled and config is valid', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
      process.env.GMAIL_USER_EMAIL = 'user@example.com';
      process.env.GMAIL_ALLOWED_LABELS = 'INBOX,SENT';

      const runner = new CursorRunner();
      runner.validateGmailConfig();

      // Check that the logger was called with the expected message
      const infoCalls = loggerInfoSpy.mock.calls;
      const hasGmailConfigMessage = infoCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP configuration is complete');
      });
      expect(hasGmailConfigMessage).toBe(true);
      
      // Check that warn was not called with Gmail-related messages
      const warnCalls = loggerWarnSpy.mock.calls;
      const hasGmailWarnMessage = warnCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP');
      });
      expect(hasGmailWarnMessage).toBe(false);
    });

    it('should log warning when Gmail MCP is enabled but config is invalid', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      const runner = new CursorRunner();
      runner.validateGmailConfig();

      // Check that the logger was called with the expected message
      const warnCalls = loggerWarnSpy.mock.calls;
      const hasGmailConfigWarning = warnCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP is enabled but configuration is incomplete');
      });
      expect(hasGmailConfigWarning).toBe(true);
      
      // Check that info was not called with Gmail-related messages
      const infoCalls = loggerInfoSpy.mock.calls;
      const hasGmailInfoMessage = infoCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP');
      });
      expect(hasGmailInfoMessage).toBe(false);
    });

    it('should log warning when Gmail MCP is enabled but only some vars are missing', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      delete process.env.GMAIL_CLIENT_SECRET;
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      const runner = new CursorRunner();
      runner.validateGmailConfig();

      // Check that the logger was called with the expected message
      const warnCalls = loggerWarnSpy.mock.calls;
      const hasGmailConfigWarning = warnCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('Gmail MCP is enabled but configuration is incomplete');
      });
      expect(hasGmailConfigWarning).toBe(true);
    });

    it('should test all combinations of ENABLE_GMAIL_MCP and required env vars', () => {
      // Test 1: Disabled, no vars
      delete process.env.ENABLE_GMAIL_MCP;
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      let runner = new CursorRunner();
      runner.validateGmailConfig();
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockClear();

      // Test 2: Enabled, all vars present
      process.env.ENABLE_GMAIL_MCP = 'true';
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      runner = new CursorRunner();
      runner.validateGmailConfig();
      expect(loggerInfoSpy).toHaveBeenCalled();
      loggerInfoSpy.mockClear();

      // Test 3: Enabled, missing vars
      process.env.ENABLE_GMAIL_MCP = '1';
      delete process.env.GMAIL_CLIENT_ID;

      runner = new CursorRunner();
      runner.validateGmailConfig();
      expect(loggerWarnSpy).toHaveBeenCalled();
    });
  });
});
