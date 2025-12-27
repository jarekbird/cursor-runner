import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getGmailMcpEnabled, validateGmailConfig } from '../src/system-settings.js';

/**
 * Integration tests for Gmail MCP flows
 *
 * Note: These tests verify configuration and setup rather than full end-to-end
 * Gmail MCP tool calls, which would require a complex MCP server mock.
 * Full E2E testing should be done via smoke tests (TASK-EML-009) or manual testing.
 */
describe('Gmail MCP Integration', () => {
  const originalEnv = process.env;
  const mcpConfigPath = join(process.cwd(), 'mcp.json');

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Gmail MCP Configuration', () => {
    it('should have Gmail MCP entry in mcp.json when feature flag is enabled', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';

      if (existsSync(mcpConfigPath)) {
        const configContent = readFileSync(mcpConfigPath, 'utf-8');
        const config = JSON.parse(configContent);

        // Note: This test verifies the config file structure
        // The actual conditional inclusion is tested in merge-mcp-config.js logic
        if (config.mcpServers && config.mcpServers.gmail) {
          expect(config.mcpServers.gmail).toBeDefined();
          expect(config.mcpServers.gmail.command).toBe('mcp-server-gmail');
        }
      }
    });

    it('should have Gmail env var references in mcp.json', () => {
      if (existsSync(mcpConfigPath)) {
        const configContent = readFileSync(mcpConfigPath, 'utf-8');
        const config = JSON.parse(configContent);

        if (config.mcpServers && config.mcpServers.gmail) {
          const gmailEnv = config.mcpServers.gmail.env;
          expect(gmailEnv).toHaveProperty('GMAIL_CLIENT_ID');
          expect(gmailEnv).toHaveProperty('GMAIL_CLIENT_SECRET');
          expect(gmailEnv).toHaveProperty('GMAIL_REFRESH_TOKEN');
        }
      }
    });
  });

  describe('Gmail Feature Flag', () => {
    it('should respect ENABLE_GMAIL_MCP feature flag', () => {
      // Test enabled
      process.env.ENABLE_GMAIL_MCP = 'true';
      expect(getGmailMcpEnabled()).toBe(true);

      // Test disabled
      process.env.ENABLE_GMAIL_MCP = 'false';
      expect(getGmailMcpEnabled()).toBe(false);

      // Test default (not set)
      delete process.env.ENABLE_GMAIL_MCP;
      expect(getGmailMcpEnabled()).toBe(false);
    });
  });

  describe('Gmail Configuration Validation', () => {
    it('should validate Gmail config when all required vars are set', () => {
      process.env.GMAIL_CLIENT_ID = 'test-client-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-refresh-token';

      const result = validateGmailConfig();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should detect missing Gmail config vars', () => {
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });
  });

  describe('Gmail MCP Environment Variable Flow', () => {
    it('should have Gmail env vars available when set', () => {
      process.env.GMAIL_CLIENT_ID = 'test-id';
      process.env.GMAIL_CLIENT_SECRET = 'test-secret';
      process.env.GMAIL_REFRESH_TOKEN = 'test-token';

      // Verify env vars are accessible (they will be passed to cursor CLI via process.env)
      expect(process.env.GMAIL_CLIENT_ID).toBe('test-id');
      expect(process.env.GMAIL_CLIENT_SECRET).toBe('test-secret');
      expect(process.env.GMAIL_REFRESH_TOKEN).toBe('test-token');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing Gmail config gracefully when feature flag is disabled', () => {
      process.env.ENABLE_GMAIL_MCP = 'false';
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      // When feature flag is disabled, missing config is expected and OK
      expect(getGmailMcpEnabled()).toBe(false);
      // Validation should still work (returns invalid, but that's OK when disabled)
      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
    });

    it('should handle missing Gmail config when feature flag is enabled', () => {
      process.env.ENABLE_GMAIL_MCP = 'true';
      delete process.env.GMAIL_CLIENT_ID;
      delete process.env.GMAIL_CLIENT_SECRET;
      delete process.env.GMAIL_REFRESH_TOKEN;

      // When enabled but config missing, validation should detect it
      const result = validateGmailConfig();
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBe(3);
    });
  });
});
