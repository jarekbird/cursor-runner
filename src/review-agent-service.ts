import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

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

  constructor(cursorCLI: CursorCLIInterface) {
    this.cursorCLI = cursorCLI;
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
   * Extract definition of done from task files
   * Looks for definition of done in common locations:
   * - .cursorrules file
   * - Task markdown files
   * - Definition of done section in files
   */
  private extractDefinitionOfDone(cwd: string, taskPrompt?: string): string | undefined {
    // Check for definition of done in .cursorrules
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

    // Check task prompt for definition of done
    if (taskPrompt) {
      const dodMatch = taskPrompt.match(/definition\s+of\s+done[:-]?\s*(.+?)(?:\n\n|\n##|$)/is);
      if (dodMatch && dodMatch[1]) {
        return dodMatch[1].trim();
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
        ['--model', 'auto', '--print', '--force', promptGenerationPrompt],
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
    // Extract definition of done if not provided
    const definitionOfDone =
      reviewOptions.definitionOfDone || this.extractDefinitionOfDone(cwd, reviewOptions.taskPrompt);

    // Use custom definition if provided, otherwise will let cursor choose from defaults
    const definitionToUse = definitionOfDone;

    // Build review prompt with definition of done context
    const reviewPrompt = `You are a review agent. Your job is to evaluate the previous agent's output and return ONLY a valid JSON object with no additional text, explanations, or formatting. 

CRITICAL: You must return ONLY the JSON object, nothing else. No explanations, no markdown, no code blocks, just the raw JSON.

Evaluate whether the task was completed according to the definition of done and if there are permission issues that require breaking iterations.

${
  definitionToUse
    ? `CUSTOM DEFINITION OF DONE:
${definitionToUse}

`
    : `DEFINITION OF DONE (choose the appropriate one based on task type):

1. CODE/FILE WRITING TASKS (involves writing, creating, modifying, or implementing SOURCE CODE FILES that need to be committed to git):
   "A Pull Request was created OR code was pushed to origin with the task complete"

2. SYSTEM/ENVIRONMENT OPERATION TASKS (installing dependencies, running builds, installing packages, running migrations, executing install scripts, etc.):
   "The required operation must complete successfully with no errors, and the expected artifacts must be created. If any part of the operation fails, the task is NOT complete."
   
   IMPORTANT: Installing dependencies requires packages to actually be installed successfully. Updating package.json is NOT enough. If the output mentions environmental issues, errors, warnings, or failed operations, the task is NOT complete.

3. SIMPLE REQUESTS/QUESTIONS/DATA OPERATIONS (asking questions, requesting information, explanations, clarifications, database queries/updates, data manipulation, executing scripts/commands that don't create source code files, etc.):
   "The request was completed or the question was answered"

TASK TYPE GUIDELINES:
- Only tasks that create/modify SOURCE CODE FILES (that should be committed to git) are code writing tasks
- Non-code tasks (database queries, data manipulation, executing commands, reading/updating data) are NOT code writing tasks and do not require git push/PR
- Installing dependencies is a SYSTEM/ENVIRONMENT OPERATION TASK, not a simple request

You must determine which type of task this is and apply the appropriate definition of done.

`
}IMPORTANT COMPLETION RULES:
- The task is complete ONLY if it meets the definition of done criteria
- If the agent reports that the project/task was already done before the task was initiated, mark code_complete: true (the task is considered complete since the desired state already exists)
- For code/file writing tasks: Completion requires an explicit "Code pushed to origin" or PR creation in the output. If neither is present, code_complete must be false. Check the cursor-cli output text for these reports - do NOT run git commands.
- For system/environment operation tasks: The operation must succeed without errors. If the output mentions failures, errors, warnings, or incomplete operations, mark code_complete: false.
- For simple requests/questions: The task is complete if the response fulfills the request. No git operations are required.

PERMISSION DETECTION RULES (CRITICAL):
- If the output mentions asking for permissions, requesting permissions, or needing permissions to run a command, mark break_iteration: true
- If the output says it doesn't have permissions, lacks permissions, or cannot run a command due to permissions, mark break_iteration: true
- If the output mentions "Workspace Trust Required", "trust", "permission denied", "access denied", or similar permission-related errors, mark break_iteration: true
- If the output indicates cursor is blocked from executing commands due to security/permission restrictions, mark break_iteration: true
- Otherwise, mark break_iteration: false

Return ONLY this JSON structure (no other text):

{
  "code_complete": true,
  "break_iteration": false,
  "justification": "Task completed successfully according to definition of done"
}

Previous agent output:
${output}`;

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
        ['--model', 'auto', '--print', '--force', reviewPrompt],
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
              definitionToUse ||
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
