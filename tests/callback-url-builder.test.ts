// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, afterEach } from '@jest/globals';
import { buildCallbackUrl, getWebhookSecret } from '../src/callback-url-builder.js';

describe('callback-url-builder', () => {
  const originalJarekVaUrl = process.env.JAREK_VA_URL;
  const originalWebhookSecret = process.env.WEBHOOK_SECRET;

  afterEach(() => {
    // Restore original environment variables
    if (originalJarekVaUrl) {
      process.env.JAREK_VA_URL = originalJarekVaUrl;
    } else {
      delete process.env.JAREK_VA_URL;
    }
    if (originalWebhookSecret) {
      process.env.WEBHOOK_SECRET = originalWebhookSecret;
    } else {
      delete process.env.WEBHOOK_SECRET;
    }
  });

  describe('buildCallbackUrl', () => {
    it('should construct callback URL with JAREK_VA_URL', () => {
      process.env.JAREK_VA_URL = 'http://app:3000';
      delete process.env.WEBHOOK_SECRET;

      const url = buildCallbackUrl();

      expect(url).toBe('http://app:3000/cursor-runner/callback');
    });

    it('should use Docker network default if JAREK_VA_URL not set', () => {
      delete process.env.JAREK_VA_URL;
      delete process.env.WEBHOOK_SECRET;

      const url = buildCallbackUrl();

      // Should default to Docker network service name
      expect(url).toBe('http://app:3000/cursor-runner/callback');
    });

    it('should include webhook secret as query parameter if set', () => {
      process.env.JAREK_VA_URL = 'http://app:3000';
      process.env.WEBHOOK_SECRET = 'test-secret-123';

      const url = buildCallbackUrl();

      expect(url).toContain('http://app:3000/cursor-runner/callback');
      expect(url).toContain('secret=test-secret-123');
    });

    it('should handle custom JAREK_VA_URL with path', () => {
      process.env.JAREK_VA_URL = 'https://example.com/api';
      delete process.env.WEBHOOK_SECRET;

      const url = buildCallbackUrl();

      // URL constructor treats absolute path as replacing the base pathname
      expect(url).toBe('https://example.com/cursor-runner/callback');
    });
  });

  describe('getWebhookSecret', () => {
    it('should return webhook secret from environment', () => {
      process.env.WEBHOOK_SECRET = 'my-secret-key';

      const secret = getWebhookSecret();

      expect(secret).toBe('my-secret-key');
    });

    it('should return null if webhook secret not set', () => {
      delete process.env.WEBHOOK_SECRET;

      const secret = getWebhookSecret();

      expect(secret).toBeNull();
    });
  });
});
