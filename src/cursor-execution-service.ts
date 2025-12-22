import path from 'path';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';
import { getWebhookSecret } from './callback-url-builder.js';
import { WorkspaceTrustService } from './workspace-trust-service.js';
import { getErrorMessage } from './error-utils.js';
import { ConversationService, type QueueType } from './conversation-service.js';
import { TerminalService } from './terminal-service.js';
import type { GitService } from './git-service.js';
import type { CursorCLI } from './cursor-cli.js';
import type { CommandParserService } from './command-parser-service.js';
import type Redis from 'ioredis';
import { MCPSelectionService } from './mcp-selection-service.js';
import { getScriptsPath, getCursorAgentsToolsPath } from './utils/path-resolver.js';

/**
 * Parameters for execute method
 */
export interface ExecuteParams {
  repository?: string | null;
  branchName?: string;
  prompt: string;
  requestId: string;
  callbackUrl?: string;
  conversationId?: string;
  queueType?: QueueType;
}

/**
 * Error response body (discriminated union member)
 */
interface ErrorResponseBody {
  success: false;
  error: string;
}

/**
 * Success response body (discriminated union member)
 */
interface SuccessResponseBody {
  success: true;
  requestId: string;
  repository?: string | null;
  branchName?: string;
  command?: readonly string[];
  output?: string;
  error?: string | null;
  exitCode?: number;
  duration: string;
  timestamp: string;
  iterations?: number;
  maxIterations?: number;
  reviewJustification?: string;
  originalOutput?: string;
}

/**
 * Error response structure (discriminated union)
 */
interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
  requestId?: string;
}

/**
 * Success response structure (discriminated union)
 */
interface SuccessResponse {
  status: number;
  body: SuccessResponseBody;
}

/**
 * Validation result - either an error response or repository path info
 */
type ValidationResult = ErrorResponse | null;

/**
 * Repository validation result
 */
interface RepositoryValidationResult {
  status?: number;
  body?: {
    success: false;
    error: string;
  };
  fullRepositoryPath?: string;
}

/**
 * Execution result
 */
type ExecutionResult = ErrorResponse | SuccessResponse;

/**
 * Callback webhook payload - can be success or error response body
 */
type CallbackWebhookPayload =
  | SuccessResponseBody
  | {
      success: false;
      requestId: string;
      repository?: string | null;
      error: string;
      exitCode?: number;
      duration?: string;
      timestamp: string;
      iterations?: number;
      maxIterations?: number;
      output?: string;
      reviewJustification?: string;
      originalOutput?: string;
    };

/**
 * System settings MCP instructions
 * These instructions are appended to all non-review agent prompts
 */
// Paths are resolved relative to TARGET_APP_PATH
const SCRIPTS_PATH = getScriptsPath();
const CURSOR_AGENTS_TOOLS_PATH = getCursorAgentsToolsPath();

/**
 * Base system instructions (not MCP-specific)
 */
const BASE_SYSTEM_INSTRUCTIONS = `\n\nIMPORTANT: Before beginning any prompt, you MUST clear all git changes (staged and unstaged) in the repository and pull the latest changes from origin. Use \`git reset --hard HEAD\` to discard all local changes, \`git clean -fd\` to remove untracked files, and then \`git pull\` to fetch and merge the latest changes from the remote repository. This ensures a clean, up-to-date working state before starting any task.


IMPORTANT: When working with cursor-agents (creating, listing, getting status, or deleting agents), use the Python scripts in ${CURSOR_AGENTS_TOOLS_PATH}/ directory. These scripts communicate with the cursor-agents service over HTTP:

Agent Management:
- To list all agents: python3 ${CURSOR_AGENTS_TOOLS_PATH}/list_agents.py
- To get agent status: python3 ${CURSOR_AGENTS_TOOLS_PATH}/get_agent_status.py --name <agent-name>
- To create an agent: python3 ${CURSOR_AGENTS_TOOLS_PATH}/create_agent.py --name <name> --target-url <url> [options]
  - Use --queue <queue-name> to assign the agent to a specific queue (defaults to "default" if not specified)
  - Use --schedule <cron-pattern> for recurring agents (e.g., "0 8 * * *" for daily at 8 AM)
  - Use --one-time for one-time agents that run immediately
  - CRITICAL: Never create agents with prompts about processing tasks - the task operator handles this automatically
- To delete an agent: python3 ${CURSOR_AGENTS_TOOLS_PATH}/delete_agent.py --name <agent-name>

Queue Management:
- To list all queues: python3 ${CURSOR_AGENTS_TOOLS_PATH}/list_queues.py
- To get queue info: python3 ${CURSOR_AGENTS_TOOLS_PATH}/get_queue_info.py --queue-name <queue-name>
- To delete an empty queue: python3 ${CURSOR_AGENTS_TOOLS_PATH}/delete_queue.py --queue-name <queue-name>
  - Note: Cannot delete the "default" queue or queues with active jobs

Task Operator Lock Management:
- To release the task operator lock (when user requests it): python3 ${CURSOR_AGENTS_TOOLS_PATH}/clear_task_operator_lock.py
  - Use this when the user explicitly asks to release the task operator lock
  - WARNING: Only use this if you're sure no task is currently being processed, as clearing the lock while a task is in progress could cause issues

When creating an agent, the target URL should be the cursor-runner docker networked URL (http://cursor-runner:3001/cursor/iterate/async) with a prompt that this agent will later execute. However, DO NOT create agents for processing tasks - use the task operator system setting instead.

Queue Organization: Agents can be organized into queues to avoid queue bloat. By default, agents are created in the "default" queue. Use descriptive queue names like "daily-tasks", "hourly-sync", or "urgent-jobs" to group related agents together.

IMPORTANT: When creating one-time scripts (shell scripts, Python scripts, etc.), place them in ${SCRIPTS_PATH}. This directory is shared and persistent across container restarts. Do not create scripts in the repository directories or other temporary locations.`;

/**
 * MCP-specific instructions by MCP name
 */
const MCP_SPECIFIC_INSTRUCTIONS: Record<string, string> = {
  'cursor-runner-shared-sqlite': `IMPORTANT: When updating system settings (SystemSetting model), you MUST use the cursor-runner-shared-sqlite MCP connection.

IMPORTANT: When working with agent tasks (creating, querying, updating, or deleting agent tasks), you MUST use the cursor-runner-shared-sqlite MCP connection. The agent tasks table is in the shared SQLite database at /app/shared_db/shared.sqlite3.

Agent Tasks Table Schema:
- id: INTEGER PRIMARY KEY AUTOINCREMENT
- prompt: TEXT NOT NULL (the agent task prompt/description to be executed)
- status: INTEGER NOT NULL DEFAULT 0 (agent task status enum: 0=ready, 1=complete, 2=archived, 3=backlogged, 4=in_progress)
- createdat: DATETIME DEFAULT CURRENT_TIMESTAMP
- updatedat: DATETIME DEFAULT CURRENT_TIMESTAMP
- order: INTEGER DEFAULT 0 (lower numbers are processed first)
- uuid: TEXT (unique identifier, indexed)

Agent Task Status Values:
- 0 = ready (ready to be processed by task operator)
- 1 = complete (agent task has been completed)
- 2 = archived (agent task has been archived)
- 3 = backlogged (agent task is in backlog, not ready for processing)
- 4 = in_progress (agent task is currently being processed)

Agent Task Management Examples:
- To create a ready agent task: INSERT INTO tasks (prompt, "order", status) VALUES ('your prompt here', 0, 0)
- To list ready agent tasks: SELECT * FROM tasks WHERE status = 0 ORDER BY "order" ASC, id ASC
- To mark an agent task as complete: UPDATE tasks SET status = 1, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To archive an agent task: UPDATE tasks SET status = 2, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To backlog an agent task: UPDATE tasks SET status = 3, updatedat = CURRENT_TIMESTAMP WHERE id = ?
- To get next ready agent task: SELECT * FROM tasks WHERE status = 0 ORDER BY "order" ASC, id ASC LIMIT 1

The task operator agent (when enabled) automatically processes agent tasks with status = 0 (ready), sending the prompt to cursor-runner for execution.

CRITICAL: DO NOT create agents or agent tasks that process agent tasks from the database. The task operator already handles this automatically. Creating agents or agent tasks with prompts like "Process ready agent tasks", "Query the agent tasks table", or "Send agent task prompts to cursor-runner" will create recursive loops and is strictly forbidden. If you need to process agent tasks, ensure the task_operator system setting is enabled - do not create additional agents or agent tasks for this purpose.`,
  'cursor-runner-shared-redis': `IMPORTANT: When working with conversation history in Redis (clearing, querying, or managing conversations), you MUST use the cursor-runner-shared-redis MCP connection. Conversation history is stored in Redis with keys like:
- cursor:conversation:{conversationId} - Individual conversation data
- cursor:last_conversation_id - Last conversation ID
To clear all conversation history, use Redis commands to delete keys matching the pattern cursor:conversation:* and cursor:last_conversation_id.`,
  gmail: `IMPORTANT: When working with Gmail (reading emails, sending emails, managing messages), you MUST use the gmail MCP connection. Use Gmail MCP tools like listMessages, getMessage, and sendReply.`,
  atlassian: `CRITICAL: The atlassian MCP connection is AVAILABLE and CONFIGURED for this request. You HAVE ACCESS to all Atlassian/Jira MCP tools.

BEFORE claiming you don't have access to Jira tools:
1. Check your available tools - look for tools with names starting with "mcp_atlassian_" (MOST COMMON) or "mcp_Atlassian-MCP-Server_" (older naming)
2. The atlassian MCP server is loaded and ready to use
3. If you cannot see the tools, try listing all available tools first before concluding they're unavailable

IMPORTANT: When working with Jira (creating issues, updating issues, querying issues, managing tickets), you MUST use the atlassian MCP connection. The following tools are available:
- mcp_atlassian_getJiraIssue - Get a Jira issue by ID or key
- mcp_atlassian_createJiraIssue - Create a new Jira issue
- mcp_atlassian_editJiraIssue - Update an existing Jira issue
- mcp_atlassian_searchJiraIssuesUsingJql - Search issues using JQL
- mcp_atlassian_transitionJiraIssue - Transition an issue to a new status
- mcp_atlassian_getAccessibleAtlassianResources - Get cloud ID for API calls
- mcp_atlassian_getVisibleJiraProjects - Get visible Jira projects
- mcp_atlassian_addCommentToJiraIssue - Add a comment to an issue
-
- If your tool inventory uses the older prefix, the same tools may appear as:
- mcp_Atlassian-MCP-Server_getJiraIssue, mcp_Atlassian-MCP-Server_editJiraIssue, etc.

CRITICAL: Issue Type Hierarchy - NEVER Create Standalone Tasks
- ALWAYS create a User Story first (issue type: Historia / ID: 10007)
- ALWAYS create Subtask(s) under the Story (issue type: Subtarea / ID: 10184)
- NEVER create standalone Tasks - Tasks are only for ad-hoc work not tied to features

Content Distribution:
- Technical Notes (customfield_10356): Business context, scope, migration patterns, implementation steps
- Acceptance Criteria (customfield_10256): Definition of done checklist, high-level story AC
- QA Test Case (customfield_10462): QA test steps, test cases, expected results

Subtask Field Inheritance:
- Team (customfield_10001) - DO NOT set on Subtask, will error
- Sprint (customfield_10020) - Inherited from parent
- Set these only on the parent Story, not on Subtasks

Pre-Submission Validation:
- Summary: 255 chars max (plain text only)
- Description/Custom Fields: 32,767 chars max (ADF JSON format)
- Estimate ADF size: plain_text_chars × 4 = estimated_adf_chars
- If estimated > 25,000 chars → STOP and summarize before submission`,
};

/**
 * Build filtered MCP instructions based on selected MCPs
 * @param selectedMcps - Array of selected MCP connection names
 * @returns Filtered instructions string
 */
function buildFilteredMcpInstructions(selectedMcps: string[]): string {
  const mcpInstructions: string[] = [];

  for (const mcpName of selectedMcps) {
    const instructions = MCP_SPECIFIC_INSTRUCTIONS[mcpName];
    if (instructions) {
      mcpInstructions.push(instructions);
    }
  }

  if (mcpInstructions.length === 0) {
    return BASE_SYSTEM_INSTRUCTIONS;
  }

  return BASE_SYSTEM_INSTRUCTIONS + '\n\n' + mcpInstructions.join('\n\n');
}

/**
 * CursorExecutionService - Orchestrates cursor command execution
 *
 * Handles repository validation, command preparation,
 * and execution coordination for both single and iterative cursor commands.
 */
export class CursorExecutionService {
  private gitService: GitService;
  private scriptsPath: string;
  private cursorCLI: CursorCLI;
  private commandParser: CommandParserService;
  private filesystem: FilesystemService;
  private workspaceTrust: WorkspaceTrustService;
  private terminalService: TerminalService;
  public conversationService: ConversationService;
  private mcpSelectionService: MCPSelectionService;

  constructor(
    gitService: GitService,
    cursorCLI: CursorCLI,
    commandParser: CommandParserService,
    filesystem: FilesystemService | null = null,
    redisClient?: Redis
  ) {
    this.gitService = gitService;
    this.cursorCLI = cursorCLI;
    this.commandParser = commandParser;
    this.filesystem = filesystem || new FilesystemService();
    this.workspaceTrust = new WorkspaceTrustService(this.filesystem);
    this.terminalService = new TerminalService();
    // Allow dependency injection of Redis for testing
    this.conversationService = new ConversationService(redisClient);
    this.scriptsPath = SCRIPTS_PATH;
    this.mcpSelectionService = new MCPSelectionService();
    this.ensureScriptsDirectory();
  }

  /**
   * Ensure scripts directory exists
   */
  private ensureScriptsDirectory(): void {
    if (!this.filesystem.exists(this.scriptsPath)) {
      try {
        mkdirSync(this.scriptsPath, { recursive: true });
        logger.info('Created scripts directory', { path: this.scriptsPath });
      } catch (error) {
        // In test environments or when permissions are insufficient, log a warning
        // The directory will be created when the container starts with proper permissions
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Could not create scripts directory', {
          path: this.scriptsPath,
          error: errorMessage,
        });
      }
    }
  }

  /**
   * Ensure repository is clean and up to date before cursor execution
   * Runs git reset --hard HEAD, git clean -fd, and git pull
   * @param repositoryPath - Path to the repository
   */
  private async ensureRepositoryClean(repositoryPath: string): Promise<void> {
    try {
      // Check if it's a git repository
      const gitDir = path.join(repositoryPath, '.git');
      if (!this.filesystem.exists(gitDir)) {
        logger.debug('Not a git repository, skipping git operations', { path: repositoryPath });
        return;
      }

      logger.info('Ensuring repository is clean and up to date', { path: repositoryPath });

      // Reset all local changes
      try {
        const resetResult = await this.terminalService.executeCommand(
          'git',
          ['reset', '--hard', 'HEAD'],
          {
            cwd: repositoryPath,
          }
        );
        if (resetResult.success) {
          logger.debug('Git reset completed', { path: repositoryPath });
        } else {
          logger.warn('Git reset completed with non-zero exit code', {
            path: repositoryPath,
            exitCode: resetResult.exitCode,
            stderr: resetResult.stderr,
          });
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.warn('Git reset failed (may be expected if no changes)', {
          path: repositoryPath,
          error: errorMessage,
        });
      }

      // Clean untracked files
      try {
        const cleanResult = await this.terminalService.executeCommand('git', ['clean', '-fd'], {
          cwd: repositoryPath,
        });
        if (cleanResult.success) {
          logger.debug('Git clean completed', { path: repositoryPath });
        } else {
          logger.warn('Git clean completed with non-zero exit code', {
            path: repositoryPath,
            exitCode: cleanResult.exitCode,
            stderr: cleanResult.stderr,
          });
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.warn('Git clean failed', {
          path: repositoryPath,
          error: errorMessage,
        });
      }

      // Pull latest changes
      try {
        const pullResult = await this.terminalService.executeCommand('git', ['pull'], {
          cwd: repositoryPath,
        });
        if (pullResult.success) {
          logger.info('Git pull completed', { path: repositoryPath, stdout: pullResult.stdout });
        } else {
          logger.warn(
            'Git pull completed with non-zero exit code (may be expected if no remote or already up to date)',
            {
              path: repositoryPath,
              exitCode: pullResult.exitCode,
              stderr: pullResult.stderr,
            }
          );
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        logger.warn('Git pull failed (may be expected if no remote or already up to date)', {
          path: repositoryPath,
          error: errorMessage,
        });
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.warn('Failed to ensure repository is clean', {
        path: repositoryPath,
        error: errorMessage,
      });
      // Don't throw - continue execution even if git operations fail
    }
  }

  /**
   * Validate execution request parameters
   * @param params - Request parameters
   * @returns Error response or null if valid
   */
  validateRequest(params: { prompt?: string }): ValidationResult {
    const { prompt } = params;

    if (!prompt) {
      return {
        status: 400,
        body: {
          success: false,
          error: 'prompt is required',
        },
      };
    }

    return null;
  }

  /**
   * Validate repository exists locally or return repositories directory
   * @param repository - Repository name (optional)
   * @returns Error response or { fullRepositoryPath } if valid
   */
  validateRepository(repository?: string | null): RepositoryValidationResult {
    const repositoryPath = this.gitService.repositoriesPath;

    // If no repository provided, use the repositories directory itself
    if (!repository || (typeof repository === 'string' && repository.trim() === '')) {
      return { fullRepositoryPath: repositoryPath };
    }

    // If repository provided, validate it exists
    const fullRepositoryPath = path.join(repositoryPath, repository);

    if (!this.filesystem.exists(fullRepositoryPath)) {
      return {
        status: 404,
        body: {
          success: false,
          error: `Repository not found locally: ${repository}. Please ensure the repository exists in the repositories directory.`,
        },
      };
    }

    return { fullRepositoryPath };
  }

  /**
   * Check for API key errors in cursor-cli output and log prominently
   * @param output - Combined stdout/stderr output from cursor-cli
   * @param requestId - Request ID for logging context
   */
  private checkForApiKeyErrors(output: string, requestId: string): void {
    const apiKeyErrorPatterns = [
      /API key.*invalid/i,
      /invalid.*API key/i,
      /API key.*is invalid/i,
      /The provided API key is invalid/i,
    ];

    const hasApiKeyError = apiKeyErrorPatterns.some((pattern) => pattern.test(output));

    if (hasApiKeyError) {
      logger.error('Cursor API key error detected', {
        requestId,
        message:
          'CURSOR_API_KEY environment variable is invalid or not set. Please set a valid CURSOR_API_KEY in your environment configuration.',
        hint: 'Check your docker-compose.yml or .env file for CURSOR_API_KEY configuration',
      });
    }
  }

  /**
   * Write filtered MCP config with only selected MCPs
   * @param selectedMcps - Array of selected MCP connection names
   * @param requestId - Request ID for logging
   */
  private async writeFilteredMcpConfig(selectedMcps: string[], requestId: string): Promise<void> {
    try {
      // Read the base MCP config.
      //
      // In Docker/prod we typically have:
      // - /cursor/mcp.json: persistent/merged config (may include user-provided MCP servers)
      // - /app/mcp.json: image-bundled cursor-runner defaults
      //
      // cursor-cli reads /root/.cursor/mcp.json.
      // We should prefer /cursor/mcp.json if it exists to avoid losing externally-managed servers.
      const baseMcpCandidatePaths = ['/cursor/mcp.json', '/root/.cursor/mcp.json', '/app/mcp.json'];
      const baseMcpPath = baseMcpCandidatePaths.find((p) => this.filesystem.exists(p));
      const cursorCliMcpPath = '/root/.cursor/mcp.json';

      if (!baseMcpPath) {
        logger.warn('Base MCP config not found, skipping filtered config generation', {
          requestId,
          pathsTried: baseMcpCandidatePaths,
        });
        return;
      }

      const baseConfig = JSON.parse(readFileSync(baseMcpPath, 'utf8'));

      // If no MCPs are selected, do NOT overwrite the MCP config with an empty file.
      // This prevents "intermittent" tool availability where a non-MCP prompt wipes out tool config.
      if (!selectedMcps || selectedMcps.length === 0) {
        const cursorCliDir = path.dirname(cursorCliMcpPath);
        if (!this.filesystem.exists(cursorCliDir)) {
          mkdirSync(cursorCliDir, { recursive: true });
        }
        writeFileSync(cursorCliMcpPath, JSON.stringify(baseConfig, null, 2) + '\n', 'utf8');
        logger.info('No MCPs selected; wrote full base MCP config to cursor-cli location', {
          requestId,
          basePathUsed: baseMcpPath,
          path: cursorCliMcpPath,
        });
        return;
      }

      const filteredConfig = { mcpServers: {} as Record<string, unknown> };

      // Some environments name Atlassian differently (e.g. hosted SSE config).
      // Support a small alias set so selecting "atlassian" still includes these servers if present.
      const MCP_NAME_ALIASES: Record<string, readonly string[]> = {
        atlassian: ['atlassian', 'Atlassian-MCP-Server'],
        gmail: ['gmail', 'Gmail-MCP-Server', 'gmail-mcp'],
        'cursor-runner-shared-sqlite': ['cursor-runner-shared-sqlite'],
        'cursor-runner-shared-redis': ['cursor-runner-shared-redis'],
      };

      // Only include selected MCPs
      if (baseConfig.mcpServers) {
        for (const mcpName of selectedMcps) {
          const aliasNames = MCP_NAME_ALIASES[mcpName] || [mcpName];
          for (const candidateName of aliasNames) {
            if (baseConfig.mcpServers[candidateName]) {
              filteredConfig.mcpServers[candidateName] = baseConfig.mcpServers[candidateName];
            }
          }
        }
      }

      // Write filtered config to cursor-cli location
      const cursorCliDir = path.dirname(cursorCliMcpPath);
      if (!this.filesystem.exists(cursorCliDir)) {
        mkdirSync(cursorCliDir, { recursive: true });
      }

      writeFileSync(cursorCliMcpPath, JSON.stringify(filteredConfig, null, 2) + '\n', 'utf8');

      // Log what MCP servers are actually in the filtered config
      const filteredServerNames = Object.keys(filteredConfig.mcpServers || {});
      logger.info('Wrote filtered MCP config', {
        requestId,
        selectedMcps,
        filteredServerNames,
        serverCount: filteredServerNames.length,
        basePathUsed: baseMcpPath,
        path: cursorCliMcpPath,
      });

      // Warn if atlassian was selected but not included in filtered config
      if (
        selectedMcps.includes('atlassian') &&
        !filteredServerNames.includes('atlassian') &&
        !filteredServerNames.includes('Atlassian-MCP-Server')
      ) {
        logger.warn(
          'atlassian was selected but not found in filtered config - this may cause tool access issues',
          {
            requestId,
            selectedMcps,
            filteredServerNames,
            baseConfigServers: Object.keys(baseConfig.mcpServers || {}),
          }
        );
      }
    } catch (error) {
      logger.error('Failed to write filtered MCP config', {
        requestId,
        error: getErrorMessage(error),
      });
      // Don't throw - continue execution even if config write fails
    }
  }

  /**
   * Prepare command with instructions
   * @param command - Original command string
   * @returns Prepared command arguments
   */
  prepareCommand(command: string): readonly string[] {
    const commandArgs = this.commandParser.parseCommand(command);
    // Use base instructions (will be filtered by prepareCommandArgsWithMcps)
    return this.commandParser.appendInstructions(commandArgs, BASE_SYSTEM_INSTRUCTIONS);
  }

  /**
   * Prepare command arguments array with instructions
   * @param args - Command arguments array
   * @returns Prepared command arguments with instructions appended
   */
  prepareCommandArgs(args: readonly string[]): readonly string[] {
    // Use base instructions (will be filtered by prepareCommandArgsWithMcps)
    return this.commandParser.appendInstructions(args, BASE_SYSTEM_INSTRUCTIONS);
  }

  /**
   * Prepare command arguments with filtered MCP instructions
   * @param args - Command arguments array
   * @param selectedMcps - Array of selected MCP connection names
   * @returns Prepared command arguments with filtered instructions appended
   */
  prepareCommandArgsWithMcps(args: readonly string[], selectedMcps: string[]): readonly string[] {
    const filteredInstructions = buildFilteredMcpInstructions(selectedMcps);
    return this.commandParser.appendInstructions(args, filteredInstructions);
  }

  /**
   * Execute a single cursor command
   * @param params - Execution parameters
   * @param params.repository - Repository name (optional, uses repositories directory if not provided)
   * @param params.branchName - Optional branch name (for logging/tracking)
   * @param params.prompt - Prompt string
   * @param params.requestId - Request ID
   * @param params.callbackUrl - Optional callback URL to notify when complete
   * @returns Execution result
   */
  async execute(params: ExecuteParams): Promise<ExecutionResult> {
    const { repository, branchName, prompt, requestId, callbackUrl, conversationId, queueType } =
      params;
    const startTime = Date.now();

    // Validate request
    const validationError = this.validateRequest({ prompt });
    if (validationError) {
      // If callback URL is provided, notify about validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            error: validationError.body?.error || 'Validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for validation error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      return { ...validationError, requestId };
    }

    // Validate repository exists or use repositories directory
    const repoValidation = this.validateRepository(repository);
    if (repoValidation.status) {
      // If callback URL is provided, notify about repository validation error
      if (callbackUrl) {
        this.callbackWebhook(
          callbackUrl,
          {
            success: false,
            requestId,
            repository,
            error: repoValidation.body?.error || 'Repository validation error',
            exitCode: 1,
            duration: '0ms',
            timestamp: new Date().toISOString(),
          },
          requestId
        ).catch((error) => {
          logger.error('Failed to call callback webhook for repository error', {
            requestId,
            callbackUrl,
            error: getErrorMessage(error),
          });
        });
      }
      const errorResponse: ErrorResponse = {
        status: repoValidation.status,
        body: repoValidation.body || {
          success: false,
          error: 'Repository validation error',
        },
        requestId,
      };
      return errorResponse;
    }
    const fullRepositoryPath = repoValidation.fullRepositoryPath;
    if (!fullRepositoryPath) {
      const errorResponse: ErrorResponse = {
        status: 500,
        body: {
          success: false,
          error: 'Failed to determine repository path',
        },
        requestId,
      };
      return errorResponse;
    }

    // Ensure workspace trust is configured before executing commands
    await this.workspaceTrust.ensureWorkspaceTrust(fullRepositoryPath);

    // Get or create conversation ID (uses last conversation if none provided, creates new if none exists)
    const actualConversationId = await this.conversationService.getConversationId(
      conversationId,
      queueType
    );

    // Get conversation context and build context string
    const conversationMessages =
      await this.conversationService.getConversationContext(actualConversationId);
    const contextString = this.conversationService.buildContextString(conversationMessages);

    // Build structured prompt that clearly separates context from current query
    // This format helps the interpreting AI agent distinguish between historical context
    // and the current request
    let fullPrompt: string;
    if (contextString) {
      fullPrompt = `=== CONVERSATION CONTEXT ===
${contextString}

=== CURRENT REQUEST ===
${prompt}`;
    } else {
      fullPrompt = prompt;
    }

    // Select relevant MCP connections based on prompt analysis
    logger.info('Selecting MCP connections for request', { requestId });
    const mcpSelection = await this.mcpSelectionService.selectMcps(prompt, contextString);

    // Safety net: If prompt explicitly mentions Jira/Atlassian terms, ensure atlassian MCP is included
    // This prevents cases where MCP selection misses obvious Jira-related prompts
    const promptLower = prompt.toLowerCase();
    const contextLower = (contextString || '').toLowerCase();
    const combinedText = `${promptLower} ${contextLower}`;
    const jiraKeywords = [
      'jira',
      'user story',
      'subtask',
      'atlassian',
      'wor-',
      'jql',
      'issue',
      'ticket',
    ];
    const mentionsJira = jiraKeywords.some((keyword) => combinedText.includes(keyword));

    if (mentionsJira && !mcpSelection.selectedMcps.includes('atlassian')) {
      logger.warn('Prompt mentions Jira but atlassian MCP not selected - adding it as safety net', {
        requestId,
        originalSelectedMcps: mcpSelection.selectedMcps,
      });
      mcpSelection.selectedMcps.push('atlassian');
    }

    logger.info('MCP selection completed', {
      requestId,
      selectedMcps: mcpSelection.selectedMcps,
      reasoning: mcpSelection.reasoning,
      mentionsJira,
    });

    // Write filtered MCP config with only selected MCPs
    await this.writeFilteredMcpConfig(mcpSelection.selectedMcps, requestId);

    // Verify the config was written correctly (diagnostic)
    const cursorCliMcpPath = '/root/.cursor/mcp.json';
    try {
      if (this.filesystem.exists(cursorCliMcpPath)) {
        const writtenConfig = JSON.parse(readFileSync(cursorCliMcpPath, 'utf8'));
        const writtenServerNames = Object.keys(writtenConfig.mcpServers || {});

        // Log the full config structure for debugging
        const configSummary: Record<string, unknown> = {};
        for (const serverName of writtenServerNames) {
          const serverConfig = writtenConfig.mcpServers[serverName];
          configSummary[serverName] = {
            command: (serverConfig as { command?: string })?.command || 'unknown',
            hasArgs: Array.isArray((serverConfig as { args?: unknown[] })?.args),
            hasEnv: typeof (serverConfig as { env?: unknown })?.env === 'object',
          };
        }

        logger.info('Verified MCP config written for cursor-cli', {
          requestId,
          writtenServerNames,
          serverCount: writtenServerNames.length,
          path: cursorCliMcpPath,
          configSummary,
          fullConfigSize: JSON.stringify(writtenConfig).length,
        });

        // Additional check: verify atlassian MCP has required env vars if it's in the config
        if (writtenServerNames.includes('atlassian')) {
          const atlassianConfig = writtenConfig.mcpServers.atlassian as {
            env?: Record<string, string>;
          };
          const hasEmail = !!atlassianConfig?.env?.ATLASSIAN_EMAIL;
          const hasToken = !!atlassianConfig?.env?.ATLASSIAN_API_TOKEN;
          const hasCloudId = !!atlassianConfig?.env?.ATLASSIAN_CLOUD_ID;

          if (!hasEmail || !hasToken || !hasCloudId) {
            logger.warn('Atlassian MCP config missing required environment variables', {
              requestId,
              hasEmail,
              hasToken,
              hasCloudId,
            });
          } else {
            logger.info('Atlassian MCP config has all required environment variables', {
              requestId,
            });
          }
        }
      } else {
        logger.warn('MCP config not found after write attempt', {
          requestId,
          path: cursorCliMcpPath,
        });
      }
    } catch (error) {
      logger.warn('Failed to verify written MCP config', {
        requestId,
        error: getErrorMessage(error),
      });
    }

    // Construct command as array to avoid parsing issues with newlines in prompt
    // --model auto uses automatic model selection (put first)
    // --print runs in non-interactive mode (required for automation)
    // --force enables file modifications
    // --approve-mcps automatically approves all MCP servers (required for headless mode)
    const commandArgs = ['--model', 'auto', '--print', '--force', '--approve-mcps', fullPrompt];

    // Prepare command with filtered MCP instructions
    const modifiedArgs = this.prepareCommandArgsWithMcps(commandArgs, mcpSelection.selectedMcps);

    // Execute cursor command
    // Log final MCP state before execution for debugging
    const finalMcpConfigPath = '/root/.cursor/mcp.json';
    let finalMcpState = 'unknown';
    if (this.filesystem.exists(finalMcpConfigPath)) {
      try {
        const finalConfig = JSON.parse(readFileSync(finalMcpConfigPath, 'utf8'));
        const finalServers = Object.keys(finalConfig.mcpServers || {});
        finalMcpState = `exists with ${finalServers.length} servers: ${finalServers.join(', ')}`;
      } catch {
        finalMcpState = 'exists but unreadable';
      }
    } else {
      finalMcpState = 'missing';
    }

    logger.info('Executing cursor command', {
      requestId,
      repository,
      branchName,
      command: modifiedArgs,
      cwd: fullRepositoryPath,
      mcpConfigState: finalMcpState,
      selectedMcps: mcpSelection.selectedMcps,
    });

    // Store what we're sending to cursor in Redis (right before sending)
    // Store only the original prompt, not fullPrompt, to avoid duplicating history
    await this.conversationService.addMessage(actualConversationId, 'user', prompt, false);

    const result = await this.cursorCLI.executeCommand([...modifiedArgs], {
      cwd: fullRepositoryPath,
    });

    // Store what we received from cursor in Redis (right after receiving)
    const assistantOutput = result.stdout || result.stderr || '';
    if (assistantOutput) {
      await this.conversationService.addMessage(
        actualConversationId,
        'assistant',
        assistantOutput,
        false
      );
    }

    // Check for context window errors and summarize if needed
    const combinedOutput = (result.stdout || '') + (result.stderr || '');
    if (this.conversationService.isContextWindowError(combinedOutput)) {
      logger.warn('Context window error detected, summarizing conversation', {
        requestId,
        conversationId: actualConversationId,
      });
      await this.summarizeConversationIfNeeded(actualConversationId, fullRepositoryPath);
    }

    // Check for API key errors and log prominently
    this.checkForApiKeyErrors(combinedOutput, requestId);

    const duration = Date.now() - startTime;
    logger.info('Cursor execution completed', {
      requestId,
      repository,
      branchName,
      conversationId: actualConversationId,
      success: result.success,
      duration: `${duration}ms`,
    });

    const responseBody: SuccessResponseBody = {
      success: true,
      requestId,
      repository,
      command: modifiedArgs,
      output: result.stdout || '',
      error: result.stderr || null,
      exitCode: result.exitCode || 0,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    };

    // Include branchName in response if provided
    if (branchName) {
      responseBody.branchName = branchName;
    }

    // If callback URL is provided, call it asynchronously (don't wait)
    if (callbackUrl) {
      this.callbackWebhook(callbackUrl, responseBody, requestId).catch((error) => {
        logger.error('Failed to call callback webhook', {
          requestId,
          callbackUrl,
          error: getErrorMessage(error),
        });
      });
    }

    return {
      status: 200,
      body: responseBody,
    };
  }

  /**
   * Summarize conversation using cursor when context window errors occur
   * Summarizes to approximately 1/3 of the original token count
   * @param conversationId - Conversation ID to summarize
   * @param cwd - Working directory for cursor execution
   */
  private async summarizeConversationIfNeeded(conversationId: string, cwd: string): Promise<void> {
    try {
      // Get raw conversation messages
      const messages = await this.conversationService.getRawConversation(conversationId);
      if (messages.length === 0) {
        logger.info('No messages to summarize', { conversationId });
        return;
      }

      // Build context string from messages
      const contextString = this.conversationService.buildContextString(messages);

      // Create summarization prompt - ask cursor to summarize to 1/3 the size
      const summarizePrompt = `Please summarize the following conversation history, reducing it to approximately 1/3 of its current size while preserving all critical information, decisions, and context needed for continuation. Focus on key decisions, important details, and maintain the essential context.

Conversation history to summarize:
${contextString}

Provide a concise summary that captures the essential information:`;

      // Select MCPs for summarization (typically none needed, but check anyway)
      const summarizeMcpSelection = await this.mcpSelectionService.selectMcps(summarizePrompt);
      logger.info('MCP selection for conversation summarization', {
        conversationId,
        selectedMcps: summarizeMcpSelection.selectedMcps,
      });

      // Update filtered MCP config if needed
      await this.writeFilteredMcpConfig(summarizeMcpSelection.selectedMcps, conversationId);

      // Use cursor to generate the summary
      // --approve-mcps automatically approves all MCP servers (required for headless mode)
      const summarizeCommandArgs = [
        '--model',
        'auto',
        '--print',
        '--force',
        '--approve-mcps',
        summarizePrompt,
      ];
      const summarizeArgs = this.prepareCommandArgsWithMcps(
        summarizeCommandArgs,
        summarizeMcpSelection.selectedMcps
      );

      logger.info('Summarizing conversation using cursor', {
        conversationId,
        messageCount: messages.length,
      });

      const summaryResult = await this.cursorCLI.executeCommand([...summarizeArgs], {
        cwd,
        timeout: 300000, // 5 minutes for summarization
      });

      const summary = summaryResult.stdout || summaryResult.stderr || '';
      if (!summary) {
        logger.warn('Empty summary received from cursor', { conversationId });
        return;
      }

      // Use the conversation service's summarize method with a function that returns our summary
      await this.conversationService.summarizeConversation(conversationId, async () => {
        return summary;
      });

      logger.info('Conversation summarized successfully', {
        conversationId,
        originalMessageCount: messages.length,
        summaryLength: summary.length,
      });
    } catch (error) {
      logger.error('Failed to summarize conversation', {
        conversationId,
        error: getErrorMessage(error),
      });
      // Don't throw - we don't want summarization failures to break execution
    }
  }

  /**
   * Call webhook callback URL with result
   * @param callbackUrl - URL to call (may include secret in query string)
   * @param result - Result to send
   * @param requestId - Request ID for logging
   * @returns Promise that resolves when webhook is called
   */
  async callbackWebhook(
    callbackUrl: string,
    result: CallbackWebhookPayload,
    requestId: string
  ): Promise<void> {
    // Check if this is an ElevenLabs callback and if feature is enabled
    // eslint-disable-next-line node/no-unsupported-features/es-syntax
    const { shouldSendElevenLabsCallback } = await import('./utils/feature-flags.js');
    if (!shouldSendElevenLabsCallback(callbackUrl)) {
      logger.info('Skipping ElevenLabs callback due to feature flag', {
        requestId,
        callbackUrl: callbackUrl.replace(/secret=[^&]*/, 'secret=***'), // Mask secret in logs
      });
      return;
    }
    try {
      logger.info('Calling callback webhook', { requestId, callbackUrl });

      // Get webhook secret from environment or URL query parameter
      const url = new URL(callbackUrl);
      let secret = url.searchParams.get('secret');

      // If no secret in URL, try environment variable
      if (!secret) {
        secret = getWebhookSecret();
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'cursor-runner/1.0',
      };

      // Add secret to headers if available
      if (secret) {
        headers['X-Webhook-Secret'] = secret;
        headers['X-Cursor-Runner-Secret'] = secret; // Also support this header name for compatibility
        // Remove secret from URL for cleaner logging
        url.searchParams.delete('secret');
        callbackUrl = url.toString();
      }

      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(result),
        // Set reasonable timeout for webhook calls
        signal: AbortSignal.timeout(30000), // 30 seconds
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Webhook returned ${response.status}: ${errorText}`);
      }

      logger.info('Callback webhook called successfully', {
        requestId,
        callbackUrl,
        status: response.status,
      });
    } catch (error) {
      // Log error but don't throw - we don't want to fail the main operation
      const err = error instanceof Error ? error : new Error(getErrorMessage(error));
      if (err.name === 'AbortError') {
        logger.error('Callback webhook timeout', { requestId, callbackUrl });
      } else {
        logger.error('Callback webhook error', {
          requestId,
          callbackUrl,
          error: getErrorMessage(err),
        });
      }
      throw err; // Re-throw so caller can handle if needed
    }
  }
}
