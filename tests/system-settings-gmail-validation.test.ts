import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { validateGmailConfig } from '../src/system-settings.js';

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
});

