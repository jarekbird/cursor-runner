import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPSelectionService } from '../src/mcp-selection-service.js';

describe('MCPSelectionService', () => {
  let service: MCPSelectionService;
  const originalEnv = process.env;

  beforeEach(() => {
    // Don't set OPENAI_API_KEY so we test keyword matching path
    delete process.env.OPENAI_API_KEY;
    service = new MCPSelectionService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Keyword-based selection (fallback)', () => {
    it('should select Redis MCP when prompt contains "redis" keyword', async () => {
      const result = await service.selectMcps('I need to clear redis cache');
      expect(result.selectedMcps).toContain('cursor-runner-shared-redis');
    });

    it('should select Redis MCP when prompt contains "clear conversation"', async () => {
      const result = await service.selectMcps('Please clear conversation history');
      expect(result.selectedMcps).toContain('cursor-runner-shared-redis');
    });

    it('should NOT select Redis MCP for generic "conversation" word alone', async () => {
      const result = await service.selectMcps('This is a conversation about code');
      expect(result.selectedMcps).not.toContain('cursor-runner-shared-redis');
    });

    it('should NOT select Redis MCP when conversation context contains "conversation" but prompt does not', async () => {
      // This tests the critical fix: conversation context should be ignored in keyword matching
      const conversationContext = 'Previous conversation about system settings and conversation history';
      const prompt = 'Write a function to parse JSON';
      const result = await service.selectMcps(prompt, conversationContext);
      expect(result.selectedMcps).not.toContain('cursor-runner-shared-redis');
    });

    it('should select Gmail MCP when prompt contains "email" keyword', async () => {
      const result = await service.selectMcps('Send an email to the team');
      expect(result.selectedMcps).toContain('gmail');
    });

    it('should select SQLite MCP when prompt contains "system setting"', async () => {
      const result = await service.selectMcps('Update system setting for feature flag');
      expect(result.selectedMcps).toContain('cursor-runner-shared-sqlite');
    });

    it('should select Jira MCP when prompt contains "jira" keyword', async () => {
      const result = await service.selectMcps('Create a jira ticket for this bug');
      expect(result.selectedMcps).toContain('jira-api-mcp-wrapper');
    });

    it('should select Atlassian MCP when prompt contains "confluence" keyword', async () => {
      const result = await service.selectMcps('Search confluence pages for documentation');
      expect(result.selectedMcps).toContain('atlassian');
    });

    it('should select multiple MCPs when prompt contains multiple keywords', async () => {
      const result = await service.selectMcps('Send email and update jira ticket');
      expect(result.selectedMcps).toContain('gmail');
      expect(result.selectedMcps).toContain('jira-api-mcp-wrapper');
    });

    it('should return empty array when no keywords match', async () => {
      const result = await service.selectMcps('Write a Python function to calculate fibonacci');
      expect(result.selectedMcps).toEqual([]);
    });

    it('should include reasoning in result', async () => {
      const result = await service.selectMcps('I need redis access');
      expect(result.reasoning).toBeDefined();
      expect(typeof result.reasoning).toBe('string');
      expect(result.reasoning).toContain('keyword matching');
    });
  });

  describe('getMcpDescriptions', () => {
    it('should return MCP connection objects for selected names', () => {
      const descriptions = service.getMcpDescriptions(['gmail', 'jira-api-mcp-wrapper']);
      expect(descriptions).toHaveLength(2);
      expect(descriptions.map((mcp) => mcp.name)).toContain('gmail');
      expect(descriptions.map((mcp) => mcp.name)).toContain('jira-api-mcp-wrapper');
    });

    it('should return empty array for empty selection', () => {
      const descriptions = service.getMcpDescriptions([]);
      expect(descriptions).toEqual([]);
    });

    it('should filter out invalid MCP names', () => {
      const descriptions = service.getMcpDescriptions(['gmail', 'invalid-mcp-name']);
      expect(descriptions).toHaveLength(1);
      expect(descriptions[0].name).toBe('gmail');
    });
  });
});

