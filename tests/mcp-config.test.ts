import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('MCP Configuration', () => {
  const mcpConfigPath = join(process.cwd(), 'mcp.json');

  it('should have valid JSON structure', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    expect(config).toHaveProperty('mcpServers');
    expect(typeof config.mcpServers).toBe('object');
  });

  it('should include gmail MCP server entry', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    expect(config.mcpServers).toHaveProperty('gmail');
    expect(config.mcpServers.gmail).toBeDefined();
  });

  it('should have gmail entry with required structure', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    const gmailEntry = config.mcpServers.gmail;
    expect(gmailEntry).toHaveProperty('command');
    expect(gmailEntry).toHaveProperty('args');
    expect(gmailEntry).toHaveProperty('env');
    expect(typeof gmailEntry.command).toBe('string');
    expect(Array.isArray(gmailEntry.args)).toBe(true);
    expect(typeof gmailEntry.env).toBe('object');
  });

  it('should have gmail command using mcp-server-gmail', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    expect(config.mcpServers.gmail.command).toBe('mcp-server-gmail');
    expect(Array.isArray(config.mcpServers.gmail.args)).toBe(true);
  });

  it('should have gmail env vars referencing GMAIL_* variables', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    const gmailEnv = config.mcpServers.gmail.env;
    expect(gmailEnv).toHaveProperty('GMAIL_CLIENT_ID');
    expect(gmailEnv).toHaveProperty('GMAIL_CLIENT_SECRET');
    expect(gmailEnv).toHaveProperty('GMAIL_REFRESH_TOKEN');
  });

  it('should not inline secrets in gmail config', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    const gmailEnv = config.mcpServers.gmail.env;
    // Check that values are environment variable references, not actual secrets
    // They should contain ${} syntax or be empty strings
    const clientSecret = gmailEnv.GMAIL_CLIENT_SECRET;
    const refreshToken = gmailEnv.GMAIL_REFRESH_TOKEN;

    // Values should be environment variable references, not actual secrets
    // This is a basic check - actual validation would need to check for common secret patterns
    expect(typeof clientSecret).toBe('string');
    expect(typeof refreshToken).toBe('string');
    // Values should reference env vars (contain ${} or be empty)
    expect(
      clientSecret.includes('${') || clientSecret === '' || clientSecret.includes('GMAIL')
    ).toBe(true);
  });

  it('should have redis command using mcp-server-redis (not npx)', () => {
    const configContent = readFileSync(mcpConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    expect(config.mcpServers).toHaveProperty('cursor-runner-shared-redis');
    const redisEntry = config.mcpServers['cursor-runner-shared-redis'];
    expect(redisEntry.command).toBe('mcp-server-redis');
    expect(redisEntry.command).not.toBe('npx');
    expect(Array.isArray(redisEntry.args)).toBe(true);
    expect(redisEntry.args).toContain('--url');
  });
});
