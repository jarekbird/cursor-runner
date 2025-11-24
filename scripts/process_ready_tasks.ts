#!/usr/bin/env tsx
/**
 * Process ready tasks from the shared SQLite database using MCP connection.
 *
 * For each ready task (status = 0):
 * 1. Mark it as in_progress (status = 4)
 * 2. Send the task prompt to cursor-runner for execution (synchronous - waits for completion)
 * 3. After completion, mark it as complete (status = 1) only if execution succeeded
 *
 * Uses the cursor-runner-shared-sqlite MCP connection to query and update the tasks table.
 * Uses the synchronous /cursor/iterate endpoint to wait for task completion before marking complete.
 * Processes one task at a time to avoid conflicts.
 */

import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

const CURSOR_RUNNER_URL = process.env.CURSOR_RUNNER_URL || 'http://cursor-runner:3001';
const DEFAULT_REPOSITORY = process.env.DEFAULT_REPOSITORY || 'telegram-receiver';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';
const DB_PATH = '/app/shared_db/shared.sqlite3';

interface Task {
  id: number;
  uuid: string | null;
  prompt: string;
  status: number;
  createdat: string;
  updatedat: string;
  order: number;
}

interface CursorRunnerResponse {
  success: boolean;
  requestId?: string;
  error?: string;
}

/**
 * Create MCP client and connect to SQLite MCP server
 */
async function createMcpClient(): Promise<Client> {
  const client = new Client(
    {
      name: 'process-ready-tasks',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  // Create transport for MCP server (mcp-server-sqlite-npx)
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'mcp-server-sqlite-npx', DB_PATH],
  });

  // Client.connect() automatically calls transport.start()
  await client.connect(transport);

  return client;
}

/**
 * Execute SQL SELECT query using MCP read_query tool
 */
async function executeReadQuery(
  client: Client,
  query: string,
  params: any[] = []
): Promise<any[]> {
  try {
    const result = await client.callTool({
      name: 'read_query',
      arguments: {
        query: query,
        params: params.length > 0 ? params : undefined,
      },
    });

    if (result.content && result.content.length > 0) {
      const content = result.content[0];
      if (content.type === 'text') {
        try {
          const parsed = JSON.parse(content.text);
          // Handle different response formats
          if (Array.isArray(parsed)) {
            return parsed;
          } else if (parsed.rows && Array.isArray(parsed.rows)) {
            return parsed.rows;
          } else if (parsed.data && Array.isArray(parsed.data)) {
            return parsed.data;
          }
          return parsed;
        } catch {
          return [];
        }
      }
    }

    return [];
  } catch (error: any) {
    throw new Error(`Failed to execute read query: ${error.message}`);
  }
}

/**
 * Execute SQL write query (UPDATE, INSERT, DELETE) using MCP write_query tool
 */
async function executeWriteQuery(
  client: Client,
  query: string,
  params: any[] = []
): Promise<void> {
  try {
    await client.callTool({
      name: 'write_query',
      arguments: {
        query: query,
        params: params.length > 0 ? params : undefined,
      },
    });
  } catch (error: any) {
    throw new Error(`Failed to execute write query: ${error.message}`);
  }
}

/**
 * Get the next ready task (status = 0), ordered by 'order' ASC, id ASC
 */
async function getNextReadyTask(client: Client): Promise<Task | null> {
  const query = `
    SELECT id, uuid, prompt, status, createdat, updatedat, "order"
    FROM tasks 
    WHERE status = 0
    ORDER BY "order" ASC, id ASC
    LIMIT 1
  `;

  const results = await executeReadQuery(client, query);
  if (results.length === 0) {
    return null;
  }

  return results[0] as Task;
}

/**
 * Mark a task as in_progress (status = 4)
 */
async function markTaskInProgress(client: Client, taskId: number): Promise<boolean> {
  const query = `
    UPDATE tasks 
    SET status = 4, updatedat = CURRENT_TIMESTAMP 
    WHERE id = ?
  `;

  try {
    await executeWriteQuery(client, query, [taskId]);
    return true;
  } catch (error) {
    console.error(`Error marking task ${taskId} as in_progress:`, error);
    return false;
  }
}

/**
 * Mark a task as complete (status = 1)
 */
async function markTaskComplete(client: Client, taskId: number): Promise<boolean> {
  const query = `
    UPDATE tasks 
    SET status = 1, updatedat = CURRENT_TIMESTAMP 
    WHERE id = ?
  `;

  try {
    await executeWriteQuery(client, query, [taskId]);
    return true;
  } catch (error) {
    console.error(`Error marking task ${taskId} as complete:`, error);
    return false;
  }
}

/**
 * Send task prompt to cursor-runner for execution (synchronous - waits for completion)
 * Only returns success: true if the task actually completed successfully (HTTP 200 + success: true in response)
 */
async function sendToCursorRunner(
  prompt: string,
  taskId: number
): Promise<CursorRunnerResponse> {
  const requestId = `task-${taskId}-${Date.now()}`;
  const payload = {
    repository: DEFAULT_REPOSITORY,
    branchName: DEFAULT_BRANCH,
    prompt: prompt,
    id: requestId,
  };

  return new Promise((resolve) => {
    const parsedUrl = url.parse(CURSOR_RUNNER_URL);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const data = JSON.stringify(payload);
    // Use synchronous endpoint - waits for task completion before responding
    // Set a very long timeout (1 hour) to handle long-running tasks
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: '/cursor/iterate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 3600000, // 1 hour timeout for long-running tasks
    };

    console.log(`Sending task ${taskId} to cursor-runner (synchronous - waiting for completion)...`);
    console.log(`  URL: ${CURSOR_RUNNER_URL}/cursor/iterate`);
    console.log(`  Request ID: ${requestId}`);
    console.log(`  Prompt preview: ${prompt.substring(0, 100)}...`);

    const req = client.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          console.log(`  Response Status: ${res.statusCode}`);
          console.log(`  Response: ${JSON.stringify(result, null, 2)}`);

          // Check for success: status code 200 AND success: true in response body
          // This ensures the task actually completed successfully before marking as complete
          if (res.statusCode === 200 && result.success === true) {
            console.log(`  ✓ Task execution completed successfully`);
            if (result.duration) {
              console.log(`  Duration: ${result.duration}`);
            }
            if (result.iterations) {
              console.log(`  Iterations: ${result.iterations}`);
            }
            resolve({
              success: true,
              requestId: result.requestId || requestId,
            });
          } else {
            const errorMsg = result.error || `Cursor-runner returned status ${res.statusCode} with success=${result.success}`;
            console.error(`  ✗ Task execution failed: ${errorMsg}`);
            resolve({
              success: false,
              error: errorMsg,
            });
          }
        } catch (error: any) {
          const errorMsg = `Failed to parse response: ${error.message}`;
          console.error(`  ✗ ${errorMsg}`);
          resolve({
            success: false,
            error: errorMsg,
          });
        }
      });
    });

    req.on('error', (error: any) => {
      const errorMsg = `Failed to connect to cursor-runner: ${error.message}`;
      console.error(`  ERROR: ${errorMsg}`);
      resolve({
        success: false,
        error: errorMsg,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const errorMsg = 'Request timeout (exceeded 1 hour)';
      console.error(`  ERROR: ${errorMsg}`);
      resolve({
        success: false,
        error: errorMsg,
      });
    });

    req.write(data);
    req.end();
  });
}

/**
 * Process ready tasks from the database one at a time
 */
async function processReadyTasks(): Promise<number> {
  let client: Client | null = null;
  let processedCount = 0;

  try {
    console.log('Connecting to MCP server...');
    client = await createMcpClient();
    console.log('Connected to MCP server');

    // List available tools to verify connection
    const tools = await client.listTools();
    console.log(`Available MCP tools: ${tools.tools.map((t) => t.name).join(', ')}`);

    while (true) {
      // Get next ready task
      const task = await getNextReadyTask(client);

      if (!task) {
        if (processedCount === 0) {
          console.log('No ready tasks found in the database (status = 0)');
        } else {
          console.log(`\nProcessed ${processedCount} task(s). No more ready tasks.`);
        }
        break;
      }

      const { id: taskId, uuid: taskUuid, prompt, order: taskOrder } = task;

      console.log('\n' + '='.repeat(80));
      console.log(`Processing Task #${taskId}`);
      console.log('='.repeat(80));
      console.log(`  UUID: ${taskUuid || '(none)'}`);
      console.log(`  Order: ${taskOrder}`);
      console.log(`  Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`);

      // Mark as in_progress
      console.log(`\n1. Marking task ${taskId} as in_progress (status = 4)...`);
      if (!(await markTaskInProgress(client, taskId))) {
        console.error(`  ERROR: Failed to mark task ${taskId} as in_progress`);
        // Continue to next task even if marking fails
        continue;
      }

      // Send to cursor-runner (synchronous - waits for completion)
      console.log(`\n2. Sending task ${taskId} to cursor-runner (waiting for completion)...`);
      const result = await sendToCursorRunner(prompt, taskId);

      // Mark as complete ONLY after successful completion
      // The sendToCursorRunner function only returns success: true if:
      // - HTTP status code is 200
      // - Response body has success: true
      // This ensures tasks are only marked complete when "the code/files were created or modified
      // as required and the task objectives were met" per the definition of done
      if (result.success) {
        console.log(`\n3. Task ${taskId} completed successfully. Marking as complete (status = 1)...`);
        if (await markTaskComplete(client, taskId)) {
          console.log(`  ✓ Task ${taskId} processed successfully`);
          processedCount++;
        } else {
          console.error(`  ERROR: Failed to mark task ${taskId} as complete`);
        }
      } else {
        console.log(`\n3. Task ${taskId} failed: ${result.error || 'Unknown error'}`);
        console.log(`  Task remains in in_progress status (status = 4) for manual review`);
        // Don't mark as complete if cursor-runner call failed
        // The task will remain in_progress for manual review
      }

      // Process only one task at a time as requested
      break;
    }

    return processedCount;
  } catch (error: any) {
    console.error('Error processing tasks:', error);
    throw error;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (error) {
        // Ignore close errors
      }
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('='.repeat(80));
  console.log('PROCESSING READY TASKS (using MCP connection)');
  console.log('='.repeat(80));
  console.log(`Database: ${DB_PATH}`);
  console.log(`Cursor Runner URL: ${CURSOR_RUNNER_URL}`);
  console.log(`Default Repository: ${DEFAULT_REPOSITORY}`);
  console.log(`Default Branch: ${DEFAULT_BRANCH}`);
  console.log('='.repeat(80));

  processReadyTasks()
    .then((count) => {
      process.exit(count >= 0 ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
