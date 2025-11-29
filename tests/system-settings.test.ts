import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  getGmailClientId,
  getGmailClientSecret,
  getGmailRefreshToken,
  getGmailUserEmail,
  getGmailAllowedLabels,
  validateGmailConfig,
  getGmailMcpEnabled,
  closeDatabase,
} from '../src/system-settings.js';

describe('system-settings Gmail configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    // Clear any cached database connection
    closeDatabase();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    // Clean up database connection
    closeDatabase();
  });

  describe('getGmailClientId', () => {
    it('should return Gmail client ID when set', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      expect(getGmailClientId()).toBe('test-client-id');
    });

    it('should return undefined when not set', () => {
      delete process.env.GMAIL_CLIENT_ID;
      expect(getGmailClientId()).toBeUndefined();
    });
  });

  describe('getGmailClientSecret', () => {
    it('should return Gmail client secret when set', () => {
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      expect(getGmailClientSecret()).toBe('test-client-secret');
    });

    it('should return undefined when not set', () => {
      delete process.env.GMAIL_CLIENT_SECRET;
      expect(getGmailClientSecret()).toBeUndefined();
    });
  });

  describe('getGmailRefreshToken', () => {
    it('should return Gmail refresh token when set', () => {
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
      expect(getGmailRefreshToken()).toBe('test-refresh-token');
    });

    it('should return undefined when not set', () => {
      delete process.env.GMAIL_REFRESH_TOKEN;
      expect(getGmailRefreshToken()).toBeUndefined();
    });
  });

  describe('getGmailUserEmail', () => {
    it('should return Gmail user email when set', () => {
      process.env.GMAIL_USER_EMAIL = 'user@example.com';
      expect(getGmailUserEmail()).toBe('user@example.com');
    });

    it('should return undefined when not set', () => {
      delete process.env.GMAIL_USER_EMAIL;
      expect(getGmailUserEmail()).toBeUndefined();
    });
  });

  describe('getGmailAllowedLabels', () => {
    it('should return Gmail allowed labels when set', () => {
      process.env.GMAIL_ALLOWED_LABELS = 'INBOX,SENT,IMPORTANT';
      expect(getGmailAllowedLabels()).toBe('INBOX,SENT,IMPORTANT');
    });

    it('should return undefined when not set', () => {
      delete process.env.GMAIL_ALLOWED_LABELS;
      expect(getGmailAllowedLabels()).toBeUndefined();
    });
  });

  describe('validateGmailConfig', () => {
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

    it('should not require optional vars (GMAIL_USER_EMAIL, GMAIL_ALLOWED_LABELS)', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';
      delete process.env.GMAIL_USER_EMAIL;
      delete process.env.GMAIL_ALLOWED_LABELS;

      const result = validateGmailConfig();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
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
});
