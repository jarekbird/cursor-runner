import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import OpenAI from 'openai';

/**
 * Available MCP connections and their descriptions
 */
export interface MCPConnection {
  name: string;
  description: string;
  keywords: string[]; // Keywords that indicate this MCP might be needed
}

/**
 * Available MCP connections
 */
export const AVAILABLE_MCP_CONNECTIONS: MCPConnection[] = [
  {
    name: 'cursor-runner-shared-sqlite',
    description: 'SQLite database access for system settings and agent tasks',
    keywords: [
      'system setting',
      'system settings',
      'agent task',
      'agent tasks',
      'sqlite',
      'database',
      'INSERT INTO',
      'UPDATE',
      'SELECT FROM',
      'tasks table',
      'system_settings table',
    ],
  },
  {
    name: 'cursor-runner-shared-redis',
    description: 'Redis access for conversation history and caching',
    keywords: [
      'redis',
      'clear conversation',
      'cache',
      'key-value',
      'cursor:conversation:',
      'cursor:last_conversation_id',
    ],
  },
  {
    name: 'gmail',
    description: 'Gmail access for reading and sending emails',
    keywords: [
      'email',
      'emails',
      'gmail',
      'mail',
      'inbox',
      'send email',
      'read email',
      'email message',
      'email messages',
      'gmail message',
      'gmail messages',
      'reply',
      'thread',
    ],
  },
  {
    name: 'jira-api-mcp-wrapper',
    description: 'Jira access (direct REST v3) for creating, updating, and querying issues',
    keywords: [
      'jira',
      'issue',
      'issues',
      'ticket',
      'tickets',
      'user story',
      'story',
      'bug',
      'epic',
      'subtask',
      'create issue',
      'update issue',
      'jira issue',
      'jira ticket',
      'create jira',
      'update jira',
      'jira query',
      'jql',
      'wor-',
      'jira mcp',
    ],
  },
  {
    name: 'atlassian',
    description: 'Atlassian access (non-Jira) such as Confluence pages/spaces (when configured)',
    keywords: [
      'atlassian',
      'confluence',
      'space',
      'spaces',
      'page',
      'pages',
      'live doc',
      'live docs',
      'cql',
    ],
  },
];

/**
 * Result of MCP selection
 */
export interface MCPSelectionResult {
  selectedMcps: string[];
  reasoning?: string;
}

/**
 * MCPSelectionService - Uses GPT-3.5 to analyze prompts and select relevant MCP connections
 *
 * This service pre-evaluates prompts to determine which MCP connections are likely needed,
 * allowing us to only load and connect the necessary MCPs for each request.
 */
export class MCPSelectionService {
  private openaiClient: OpenAI | null = null;

  constructor() {
    // Initialize OpenAI client if API key is available
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    } else {
      logger.warn(
        'OPENAI_API_KEY not set. MCP selection will fall back to keyword-based matching.'
      );
    }
  }

  /**
   * Select relevant MCP connections based on prompt analysis
   * Uses GPT-3.5 if available, otherwise falls back to keyword matching
   * @param prompt - The prompt to analyze
   * @param conversationContext - Optional conversation context
   * @returns Selected MCP connection names
   */
  async selectMcps(prompt: string, conversationContext?: string): Promise<MCPSelectionResult> {
    // If OpenAI client is available, use GPT-3.5 for intelligent selection
    if (this.openaiClient) {
      try {
        return await this.selectMcpsWithGPT(prompt, conversationContext);
      } catch (error) {
        logger.warn('GPT-3.5 MCP selection failed, falling back to keyword matching', {
          error: getErrorMessage(error),
        });
        // Fall back to keyword matching
        return this.selectMcpsWithKeywords(prompt, conversationContext);
      }
    }

    // Fall back to keyword-based matching
    return this.selectMcpsWithKeywords(prompt, conversationContext);
  }

  /**
   * Select MCPs using GPT-3.5
   * @param prompt - The prompt to analyze
   * @param conversationContext - Optional conversation context
   * @returns Selected MCP connection names
   */
  private async selectMcpsWithGPT(
    prompt: string,
    conversationContext?: string
  ): Promise<MCPSelectionResult> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    // Build the full context
    const fullContext = conversationContext
      ? `${conversationContext}\n\n[Current Request]: ${prompt}`
      : prompt;

    // Create a description of available MCPs
    const mcpDescriptions = AVAILABLE_MCP_CONNECTIONS.map(
      (mcp) => `- ${mcp.name}: ${mcp.description}`
    ).join('\n');

    const selectionPrompt = `You are analyzing a prompt to determine which MCP (Model Context Protocol) connections are likely needed.

Available MCP connections:
${mcpDescriptions}

User prompt:
${fullContext}

Based on the prompt, select which MCP connections are likely to be needed. Be conservative - only select MCPs that are clearly needed based on the prompt content.

IMPORTANT selection guidance:
- For Jira (issues, JQL, WOR-* keys, stories/subtasks/epics/bugs, updating fields): prefer \`jira-api-mcp-wrapper\`.
- Use \`atlassian\` for Confluence (pages/spaces/CQL) or other non-Jira Atlassian tools.

Respond with a JSON object in this exact format:
{
  "selectedMcps": ["mcp-name-1", "mcp-name-2"],
  "reasoning": "Brief explanation of why these MCPs were selected"
}

Only include MCP names that are in the available list. If no MCPs are needed, return an empty array.`;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that analyzes prompts to determine which MCP connections are needed. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: selectionPrompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent selection
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in GPT response');
      }

      // Extract JSON from response (may be wrapped in markdown code blocks)
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```')) {
        // Remove markdown code blocks
        jsonContent = jsonContent.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
      }

      const parsed = JSON.parse(jsonContent) as MCPSelectionResult;

      // Validate that all selected MCPs are in the available list
      const validMcps = AVAILABLE_MCP_CONNECTIONS.map((mcp) => mcp.name);
      const selectedMcps = (parsed.selectedMcps || []).filter((mcp) => validMcps.includes(mcp));

      logger.info('MCP selection completed using GPT-3.5', {
        selectedMcps,
        reasoning: parsed.reasoning,
      });

      return {
        selectedMcps,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Failed to select MCPs with GPT-3.5', { error: errorMessage });
      throw error;
    }
  }

  /**
   * Select MCPs using keyword matching (fallback method)
   * @param prompt - The prompt to analyze
   * @param conversationContext - Optional conversation context
   * @returns Selected MCP connection names
   */
  private selectMcpsWithKeywords(prompt: string, conversationContext?: string): MCPSelectionResult {
    // IMPORTANT: Keyword matching should be based on the *current user prompt only*.
    //
    // Including conversation context here creates false positives because the context wrapper
    // often contains generic words like "conversation", which would select the Redis MCP
    // for nearly every request and trigger costly `--approve-mcps` eager initialization.
    //
    // If you need more intelligent selection that considers prior context, use the GPT-based
    // selection path (OPENAI_API_KEY) which is explicitly instructed to be conservative.
    const fullText = prompt.toLowerCase();

    const selectedMcps: string[] = [];

    for (const mcp of AVAILABLE_MCP_CONNECTIONS) {
      // Check if any keywords match
      const hasMatch = mcp.keywords.some((keyword) => fullText.includes(keyword.toLowerCase()));

      if (hasMatch) {
        selectedMcps.push(mcp.name);
      }
    }

    logger.info('MCP selection completed using keyword matching', {
      selectedMcps,
    });

    return {
      selectedMcps,
      reasoning: `Selected based on keyword matching: ${selectedMcps.join(', ')}`,
    };
  }

  /**
   * Get descriptions for selected MCPs
   * @param selectedMcps - Array of selected MCP names
   * @returns Array of MCP connection objects
   */
  getMcpDescriptions(selectedMcps: string[]): MCPConnection[] {
    return AVAILABLE_MCP_CONNECTIONS.filter((mcp) => selectedMcps.includes(mcp.name));
  }
}
