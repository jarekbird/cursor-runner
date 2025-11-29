import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { isSystemSettingEnabled } from './system-settings.js';

/**
 * Review result structure returned by the review agent
 */
interface ReviewResult {
  code_complete: boolean;
  break_iteration: boolean;
  justification: string;
  continuationPrompt?: string; // Prompt to drive worker agent to completion
}

/**
 * Result of reviewOutput method
 */
export interface ReviewOutputResult {
  result: ReviewResult | null;
  rawOutput: string;
  prompt?: string; // The prompt that was sent to cursor for review
}

/**
 * Options for reviewOutput method
 */
export interface ReviewOutputOptions {
  taskPrompt?: string; // Original task prompt
  definitionOfDone?: string; // Custom definition of done from task/files
  branchName?: string; // Branch name for context
}

/**
 * Options for executeCommand method
 */
interface ExecuteCommandOptions {
  cwd?: string;
  timeout?: number;
}

/**
 * Result of executeCommand method
 */
interface ExecuteCommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Interface for CursorCLI instance
 */
interface CursorCLIInterface {
  executeCommand(
    args: readonly string[],
    options?: ExecuteCommandOptions
  ): Promise<ExecuteCommandResult>;
}

/**
 * ReviewAgentService - Uses cursor as a review agent to evaluate code completion
 *
 * Analyzes cursor output to determine if code generation is complete.
 * Uses definition of done (from task/files or default) to evaluate completion.
 */
export class ReviewAgentService {
  protected cursorCLI: CursorCLIInterface;
  protected openaiClient: OpenAI | null = null;

  constructor(cursorCLI: CursorCLIInterface) {
    this.cursorCLI = cursorCLI;
    // Initialize OpenAI client if API key is available
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }
  }

  /**
   * Determine if task is a simple request/question or requires code/file writing
   * @param taskPrompt - The task prompt
   * @param output - The worker agent's output
   * @returns true if task requires code/files to be written, false if it's a simple request/question
   */
  private isCodeWritingTask(taskPrompt?: string, output?: string): boolean {
    if (!taskPrompt && !output) {
      return true; // Default to code writing task if we can't determine
    }

    const combinedText = `${taskPrompt || ''} ${output || ''}`.toLowerCase();

    // Keywords that indicate code/file writing
    const codeWritingKeywords = [
      'write',
      'create',
      'implement',
      'add',
      'build',
      'develop',
      'code',
      'file',
      'function',
      'class',
      'module',
      'service',
      'component',
      'script',
      'program',
      'feature',
      'fix',
      'refactor',
      'update',
      'modify',
      'change',
      'edit',
      'delete',
      'remove',
      'test',
      'spec',
    ];

    // Keywords that indicate simple request/question
    const simpleRequestKeywords = [
      'what',
      'how',
      'why',
      'when',
      'where',
      'who',
      'explain',
      'describe',
      'tell me',
      'show me',
      'help',
      'question',
      'answer',
      'clarify',
      'understand',
      'meaning',
      'definition',
    ];

    // Count matches
    const codeWritingMatches = codeWritingKeywords.filter((keyword) =>
      combinedText.includes(keyword)
    ).length;
    const simpleRequestMatches = simpleRequestKeywords.filter((keyword) =>
      combinedText.includes(keyword)
    ).length;

    // If output contains code blocks, file paths, or git operations, it's likely a code writing task
    const hasCodeIndicators =
      combinedText.includes('```') ||
      combinedText.includes('def ') ||
      combinedText.includes('function ') ||
      combinedText.includes('class ') ||
      combinedText.includes('import ') ||
      combinedText.includes('require(') ||
      combinedText.includes('git ') ||
      combinedText.match(/\.(js|ts|py|rb|java|cpp|go|rs|php|html|css|json|yaml|yml|md|sh|sql)/);

    // If there are code indicators, it's definitely a code writing task
    if (hasCodeIndicators) {
      return true;
    }

    // If simple request keywords significantly outnumber code writing keywords, it's a simple request
    if (simpleRequestMatches > codeWritingMatches * 2) {
      return false;
    }

    // Default to code writing task if code writing keywords are present or if ambiguous
    return codeWritingMatches > 0;
  }

  /**
   * Extract file paths from task prompt
   * Looks for patterns like:
   * - "task at <path>"
   * - "task file <path>"
   * - "file <path>"
   * - Markdown links [text](path)
   */
  private extractFilePathsFromPrompt(taskPrompt: string): string[] {
    const filePaths: string[] = [];

    // Pattern 1: "task at <path>" or "task file <path>"
    const taskAtPattern = /task\s+(?:at|file)\s+([^\s\n]+\.md)/gi;
    let match;
    while ((match = taskAtPattern.exec(taskPrompt)) !== null) {
      if (match[1]) {
        filePaths.push(match[1]);
      }
    }

    // Pattern 2: Markdown links [text](path.md)
    const markdownLinkPattern = /\[([^\]]+)\]\(([^\s)]+\.md)\)/gi;
    while ((match = markdownLinkPattern.exec(taskPrompt)) !== null) {
      if (match[2]) {
        filePaths.push(match[2]);
      }
    }

    // Pattern 3: Direct file paths ending in .md
    const directPathPattern = /([^\s\n]+\.md)/gi;
    while ((match = directPathPattern.exec(taskPrompt)) !== null) {
      if (match[1] && !filePaths.includes(match[1])) {
        // Only add if it looks like a task file path (contains "task" or "Plan" or similar)
        const pathLower = match[1].toLowerCase();
        if (pathLower.includes('task') || pathLower.includes('plan') || pathLower.includes('/')) {
          filePaths.push(match[1]);
        }
      }
    }

    return filePaths;
  }

  /**
   * Load definition of done from a task file
   * @param filePath - Path to the task file (can be relative or absolute)
   * @param cwd - Working directory for resolving relative paths
   * @returns Definition of done content or undefined if not found
   */
  private loadDefinitionOfDoneFromTaskFile(filePath: string, cwd: string): string | undefined {
    // Get repositories path (same logic as GitService)
    const repositoriesPath =
      process.env.REPOSITORIES_PATH || path.join(process.cwd(), 'repositories');

    // Try multiple path resolutions
    const possiblePaths = [
      filePath, // Try as-is (absolute or relative to cwd)
      path.join(cwd, filePath), // Relative to cwd
      path.join(repositoriesPath, filePath), // Relative to repositories directory
      path.join(process.cwd(), filePath), // Relative to process cwd
      path.resolve(cwd, filePath), // Resolved relative to cwd
      path.resolve(repositoriesPath, filePath), // Resolved relative to repositories directory
    ];

    for (const fullPath of possiblePaths) {
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8');

          // Look for definition of done section
          // Pattern 1: "## Definition of Done" or "### Definition of Done" section
          const sectionPattern = /##+\s*definition\s+of\s+done\s*\n(.+?)(?=\n##|\n---|$)/is;
          const sectionMatch = content.match(sectionPattern);
          if (sectionMatch && sectionMatch[1]) {
            return sectionMatch[1].trim();
          }

          // Pattern 2: "Definition of Done:" or "Definition of Done:" followed by content
          const inlinePattern = /definition\s+of\s+done[:-]?\s*\n(.+?)(?=\n\n|\n##|\n---|$)/is;
          const inlineMatch = content.match(inlinePattern);
          if (inlineMatch && inlineMatch[1]) {
            return inlineMatch[1].trim();
          }

          // Pattern 3: Look for it anywhere in the file (less specific)
          const anywherePattern = /definition\s+of\s+done[:-]?\s*(.+?)(?=\n\n|\n##|\n---|$)/is;
          const anywhereMatch = content.match(anywherePattern);
          if (anywhereMatch && anywhereMatch[1] && anywhereMatch[1].trim().length > 10) {
            return anywhereMatch[1].trim();
          }
        } catch (error) {
          logger.warn('Failed to read task file for definition of done', {
            filePath: fullPath,
            error: getErrorMessage(error),
          });
        }
      }
    }

    return undefined;
  }

  /**
   * Extract definition of done from task files (if provided)
   * Looks for custom definition of done in:
   * - Task files referenced in task prompt (e.g., "task at path/to/file.md")
   * - Task prompt itself (inline definition)
   * - .cursorrules file (task-specific override)
   */
  private extractDefinitionOfDone(cwd: string, taskPrompt?: string): string | undefined {
    // First, check for inline definition in task prompt
    if (taskPrompt) {
      const dodMatch = taskPrompt.match(/definition\s+of\s+done[:-]?\s*(.+?)(?:\n\n|\n##|$)/is);
      if (dodMatch && dodMatch[1]) {
        return dodMatch[1].trim();
      }

      // Extract file paths from task prompt and check each one
      const filePaths = this.extractFilePathsFromPrompt(taskPrompt);
      for (const filePath of filePaths) {
        const definition = this.loadDefinitionOfDoneFromTaskFile(filePath, cwd);
        if (definition) {
          logger.debug('Found definition of done in task file', { filePath });
          return definition;
        }
      }
    }

    // Check for definition of done in .cursorrules (task-specific override)
    const cursorRulesPath = path.join(cwd, '.cursorrules');
    if (existsSync(cursorRulesPath)) {
      try {
        const content = readFileSync(cursorRulesPath, 'utf-8');
        const dodMatch = content.match(/definition\s+of\s+done[:-]?\s*(.+?)(?:\n\n|\n##|$)/is);
        if (dodMatch && dodMatch[1]) {
          return dodMatch[1].trim();
        }
      } catch (error) {
        logger.warn('Failed to read .cursorrules for definition of done', {
          error: getErrorMessage(error),
        });
      }
    }

    return undefined;
  }

  /**
   * Generate a continuation prompt using cursor to drive worker agent to completion
   * @param output - Previous agent output
   * @param taskPrompt - Original task prompt
   * @param definitionOfDone - Definition of done
   * @param cwd - Working directory
   * @param timeout - Optional timeout override
   * @returns Generated continuation prompt or null if generation failed
   */
  private async generateContinuationPrompt(
    output: string,
    taskPrompt: string,
    definitionOfDone: string,
    cwd: string,
    timeout: number | null = null
  ): Promise<string | null> {
    const promptGenerationPrompt = `You are a review agent. Based on the worker agent's output and the definition of done, generate a prompt that will drive the worker agent to complete the task.

Task Prompt:
${taskPrompt}

Definition of Done:
${definitionOfDone}

Previous Worker Agent Output:
${output.substring(0, 5000)}${output.length > 5000 ? '...' : ''}

Generate a clear, actionable prompt that will guide the worker agent to complete the task according to the definition of done. The prompt should:
1. Be specific about what needs to be done
2. Reference the definition of done
3. Address any gaps - check if the output reports "Code pushed to origin" or mentions a Pull Request was created (for code writing tasks)
4. Be concise but complete

Return ONLY the prompt text, no explanations, no JSON, just the prompt that should be given to the worker agent.`;

    try {
      const executeOptions: ExecuteCommandOptions = { cwd };
      if (timeout) {
        executeOptions.timeout = timeout;
      }

      // IMPORTANT: This call to cursor for prompt generation is NOT recorded in conversation history.
      // The review agent's internal calls should not pollute the conversation context.
      // Use --model auto for consistent model selection (same as main execution)

      const result = await this.cursorCLI.executeCommand(
        ['--model', 'auto', '--print', '--force', '--debug', promptGenerationPrompt],
        executeOptions
      );

      // Clean the output
      // eslint-disable-next-line no-control-regex
      const ansiEscapeRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
      const cleanedOutput = result.stdout
        .replace(ansiEscapeRegex, '')
        .replace(/\r\n/g, '\n')
        .trim();

      return cleanedOutput || null;
    } catch (error) {
      logger.warn('Failed to generate continuation prompt', {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Review output using OpenAI GPT-3.5 turbo
   * @param output - Output to review
   * @param reviewPrompt - The review prompt to send to GPT-3.5 turbo
   * @returns Review result with parsed result and raw output
   */
  private async reviewWithOpenAI(
    output: string,
    reviewPrompt: string
  ): Promise<ReviewOutputResult> {
    if (!this.openaiClient) {
      throw new Error(
        'OpenAI client not initialized. OPENAI_API_KEY environment variable is required.'
      );
    }

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              "You are a review agent. Evaluate the previous agent's output and return ONLY a valid JSON object with no additional text. CRITICAL: Return ONLY the JSON object, nothing else. No explanations, no markdown, no code blocks, just the raw JSON.",
          },
          {
            role: 'user',
            content: reviewPrompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent JSON output
        max_tokens: 500,
      });

      const rawOutput = response.choices[0]?.message?.content || '';
      const cleanedOutput = rawOutput.trim();

      // Try to find JSON object in the output
      const jsonStart = cleanedOutput.indexOf('{');
      if (jsonStart === -1) {
        logger.warn('No JSON object found in OpenAI review output', {
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput, prompt: reviewPrompt };
      }

      // Find the matching closing brace
      let braceCount = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < cleanedOutput.length; i++) {
        if (cleanedOutput[i] === '{') {
          braceCount++;
        } else if (cleanedOutput[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd === -1) {
        logger.warn('Incomplete JSON object in OpenAI review output', {
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput, prompt: reviewPrompt };
      }

      const jsonString = cleanedOutput.substring(jsonStart, jsonEnd);

      try {
        const parsed = JSON.parse(jsonString) as Partial<ReviewResult>;
        // Validate required fields
        if (typeof parsed.code_complete !== 'boolean') {
          logger.warn('OpenAI review JSON missing required fields', { parsed });
          return { result: null, rawOutput: jsonString, prompt: reviewPrompt };
        }
        // Set break_iteration default to false if not provided
        if (typeof parsed.break_iteration !== 'boolean') {
          parsed.break_iteration = false;
        }

        const result: ReviewResult = {
          code_complete: parsed.code_complete,
          break_iteration: parsed.break_iteration || false,
          justification: parsed.justification || 'No justification provided',
        };

        return {
          result,
          rawOutput: jsonString,
          prompt: reviewPrompt,
        };
      } catch (parseError) {
        const error = parseError instanceof Error ? parseError : new Error(String(parseError));
        logger.warn('Failed to parse OpenAI review JSON', {
          error: error.message,
          jsonString: jsonString.substring(0, 200),
        });
        return { result: null, rawOutput: jsonString, prompt: reviewPrompt };
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('OpenAI review failed', { error: errorMessage });
      return {
        result: null,
        rawOutput: `OpenAI review error: ${errorMessage}`,
        prompt: reviewPrompt,
      };
    }
  }

  /**
   * Review output using cursor as a review agent
   * @param output - Output to review
   * @param cwd - Working directory
   * @param timeout - Optional timeout override
   * @param options - Optional review options (task prompt, definition of done, branch name)
   * @returns Review result with parsed result and raw output
   *   - result: Parsed review result or null if parsing failed
   *   - rawOutput: Raw output from review agent
   */
  async reviewOutput(
    output: string,
    cwd: string,
    timeout: number | null = null,
    reviewOptions: ReviewOutputOptions = {}
  ): Promise<ReviewOutputResult> {
    // Extract custom definition of done if provided (from task prompt or .cursorrules)
    const definitionOfDone =
      reviewOptions.definitionOfDone || this.extractDefinitionOfDone(cwd, reviewOptions.taskPrompt);

    // Build review prompt with simple done check
    const reviewPrompt = `You are a review agent. Evaluate the previous agent's output and return ONLY a valid JSON object with no additional text.

CRITICAL: Return ONLY the JSON object, nothing else. No explanations, no markdown, no code blocks, just the raw JSON.

Evaluate the output for:
1. Is the task done according to the definition of done?
2. Are there permission or other unfixable issues that require breaking iterations (set break_iteration: true)?
3. If any command seems to be creating an interactive prompt, set break_iteration: true
4. Are there deployment issues, warnings, or errors that indicate the deployment is broken?

CRITICAL DEPLOYMENT CHECKS - REJECT (set code_complete: false) if any of these are present:
- Warnings about missing MCP servers (e.g., "MCP server not found", "cursor-agents MCP server not found")
- Deployment errors or warnings in logs
- Infrastructure issues (missing files, broken connections, failed services)
- Any warnings that indicate the system is not properly deployed or configured
- Docker/container errors or warnings
- Missing dependencies or services

IMPORTANT: When deployment issues are detected:
- Set "code_complete" to false (task is not complete)
- Set "break_iteration" to false (do NOT break - allow continuation to fix the issue)
- Provide a clear justification describing the deployment issue
- The system will generate a continuation prompt to guide the worker agent to fix the deployment

${
  definitionOfDone
    ? `CUSTOM DEFINITION OF DONE:
${definitionOfDone}

`
    : ''
}

Return ONLY this JSON structure:

{
  "code_complete": true,
  "break_iteration": false,
  "justification": "Brief explanation"
}

If deployment issues are found, use this structure:
{
  "code_complete": false,
  "break_iteration": false,
  "justification": "Deployment issue detected: [describe the issue]. The worker agent must fix the deployment before the task can be considered complete."
}

Previous agent output:
${output}`;

    // Check if GPT review is enabled via system setting
    const useGPTReview = isSystemSettingEnabled('gpt-review');

    // If GPT review is enabled but OpenAI client is not available, log warning and fall back to cursor
    if (useGPTReview && !this.openaiClient) {
      logger.warn(
        'GPT review is enabled but OPENAI_API_KEY is not set. Falling back to cursor review.',
        {}
      );
    }

    // If GPT review is enabled and OpenAI client is available, use OpenAI
    if (useGPTReview && this.openaiClient) {
      logger.debug('Using OpenAI GPT-3.5 turbo for review', {});
      const reviewResult = await this.reviewWithOpenAI(output, reviewPrompt);

      // If task is not complete and we have a task prompt, generate continuation prompt
      if (
        reviewResult.result &&
        !reviewResult.result.code_complete &&
        !reviewResult.result.break_iteration &&
        reviewOptions.taskPrompt
      ) {
        try {
          const generatedPrompt = await this.generateContinuationPrompt(
            output,
            reviewOptions.taskPrompt || '',
            definitionOfDone ||
              'The code/files were created or modified as required and the task objectives were met',
            cwd,
            timeout
          );
          if (generatedPrompt) {
            reviewResult.result.continuationPrompt = generatedPrompt;
          }
        } catch (error) {
          logger.warn('Failed to generate continuation prompt for OpenAI review', {
            error: getErrorMessage(error),
          });
        }
      }

      return reviewResult;
    }

    // Otherwise, use cursor as before
    // (reviewPrompt is already defined above)

    try {
      const executeOptions: ExecuteCommandOptions = { cwd };
      if (timeout) {
        executeOptions.timeout = timeout;
      }
      // Use --print for non-interactive mode (required for automation)
      // Use --force to enable actual file operations and avoid permission prompts
      // Note: Don't use --resume as it triggers session selection menu when no session ID provided
      // Cursor maintains session context automatically within the same workspace
      // Use --model auto for consistent model selection (same as main execution)
      // IMPORTANT: This call to cursor is NOT recorded in conversation history.
      // The review agent's calls are internal and should not pollute the conversation context.

      const result = await this.cursorCLI.executeCommand(
        ['--model', 'auto', '--print', '--force', '--debug', reviewPrompt],
        executeOptions
      );

      // Clean the output - remove ANSI escape sequences and trim whitespace
      // eslint-disable-next-line no-control-regex
      const ansiEscapeRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
      let cleanedOutput = result.stdout
        .replace(ansiEscapeRegex, '') // Remove ANSI escape codes
        .replace(/\r\n/g, '\n') // Normalize line endings
        .trim();

      // Filter out conversation history that cursor may include
      // Look for patterns that indicate conversation history (user:/cursor: prefixes)
      // The review agent should only return JSON, so we remove everything before the JSON
      const conversationHistoryPattern = /^(user:|cursor:).*$/gm;
      const lines = cleanedOutput.split('\n');

      // Find the first line that contains a JSON object start (look for {)
      let jsonStartLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        // Look for lines that start with { or contain { and are likely JSON
        if (
          trimmedLine.startsWith('{') ||
          (trimmedLine.includes('{') && trimmedLine.match(/^\s*\{/))
        ) {
          jsonStartLineIndex = i;
          break;
        }
      }

      // If we found a JSON start line, only keep from that line onwards (removes conversation history)
      // This ensures we only return the review agent's JSON response, not the full conversation
      if (jsonStartLineIndex >= 0) {
        cleanedOutput = lines.slice(jsonStartLineIndex).join('\n');
      } else {
        // If no clear JSON start found, try to remove conversation history patterns
        // This is a fallback in case the JSON is on the same line as other content
        cleanedOutput = cleanedOutput.replace(conversationHistoryPattern, '').trim();
      }

      // Try to find JSON object in the output
      // First, try to find a complete JSON object by matching braces
      const jsonStart = cleanedOutput.indexOf('{');
      if (jsonStart === -1) {
        logger.warn('No JSON object found in review output', {
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput, prompt: reviewPrompt };
      }

      // Find the matching closing brace
      let braceCount = 0;
      let jsonEnd = -1;
      for (let i = jsonStart; i < cleanedOutput.length; i++) {
        if (cleanedOutput[i] === '{') {
          braceCount++;
        } else if (cleanedOutput[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }

      if (jsonEnd === -1) {
        logger.warn('Incomplete JSON object in review output', {
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput, prompt: reviewPrompt };
      }

      // Extract the JSON substring - this is what we'll use as rawOutput
      const jsonString = cleanedOutput.substring(jsonStart, jsonEnd);

      try {
        const parsed = JSON.parse(jsonString) as Partial<ReviewResult>;
        // Validate required fields
        if (typeof parsed.code_complete !== 'boolean') {
          logger.warn('Review JSON missing required fields', { parsed });
          // Return only the JSON part if found, otherwise return cleaned output
          const jsonOnly = jsonStart >= 0 && jsonEnd >= 0 ? jsonString : cleanedOutput;
          return { result: null, rawOutput: jsonOnly, prompt: reviewPrompt };
        }
        // Set break_iteration default to false if not provided
        if (typeof parsed.break_iteration !== 'boolean') {
          parsed.break_iteration = false;
        }

        // If task is not complete according to definition of done, generate continuation prompt
        let continuationPrompt: string | undefined;
        if (!parsed.code_complete && !parsed.break_iteration && reviewOptions.taskPrompt) {
          try {
            const generatedPrompt = await this.generateContinuationPrompt(
              output,
              reviewOptions.taskPrompt || '',
              definitionOfDone ||
                'The code/files were created or modified as required and the task objectives were met',
              cwd,
              timeout
            );
            if (generatedPrompt) {
              continuationPrompt = generatedPrompt;
            }
          } catch (error) {
            logger.warn('Failed to generate continuation prompt', {
              error: getErrorMessage(error),
            });
          }
        }

        const result: ReviewResult = {
          code_complete: parsed.code_complete,
          break_iteration: parsed.break_iteration || false,
          justification: parsed.justification || 'No justification provided',
          ...(continuationPrompt && { continuationPrompt }),
        };

        return {
          result,
          // Only return the JSON part, not the full output with conversation history
          rawOutput: jsonString,
          prompt: reviewPrompt, // Include the prompt that was sent
        };
      } catch (parseError) {
        const error = parseError instanceof Error ? parseError : new Error(String(parseError));
        logger.warn('Failed to parse review JSON', {
          error: error.message,
          jsonString: jsonString.substring(0, 200),
          outputPreview: cleanedOutput.substring(0, 200),
        });
        // Return only the JSON part if found, otherwise return cleaned output
        const jsonOnly = jsonStart >= 0 && jsonEnd >= 0 ? jsonString : cleanedOutput;
        return { result: null, rawOutput: jsonOnly, prompt: reviewPrompt };
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Review agent failed', { error: errorMessage });
      // Return error message as raw output
      return {
        result: null,
        rawOutput: `Review agent error: ${errorMessage}`,
        prompt: undefined, // No prompt available on error
      };
    }
  }
}
