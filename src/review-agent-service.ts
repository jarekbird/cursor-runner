import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { GitCompletionChecker, CompletionCheckResult } from './git-completion-checker.js';
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
interface ReviewOutputResult {
  result: ReviewResult | null;
  rawOutput: string;
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
  private gitCompletionChecker: GitCompletionChecker;

  constructor(cursorCLI: CursorCLIInterface) {
    this.cursorCLI = cursorCLI;
    this.gitCompletionChecker = new GitCompletionChecker();
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
   * @param completionCheck - Result of completion check
   * @param cwd - Working directory
   * @param timeout - Optional timeout override
   * @returns Generated continuation prompt or null if generation failed
   */
  private async generateContinuationPrompt(
    output: string,
    taskPrompt: string,
    definitionOfDone: string,
    completionCheck: CompletionCheckResult,
    cwd: string,
    timeout: number | null = null
  ): Promise<string | null> {
    const promptGenerationPrompt = `You are a review agent. Based on the worker agent's output and the definition of done, generate a prompt that will drive the worker agent to complete the task.

Task Prompt:
${taskPrompt}

Definition of Done:
${definitionOfDone}

Completion Status:
- Has Pull Request: ${completionCheck.hasPullRequest}
- Has Pushed Commits: ${completionCheck.hasPushedCommits}
- Is Complete: ${completionCheck.isComplete}
- Reason: ${completionCheck.reason}

Previous Worker Agent Output:
${output.substring(0, 5000)}${output.length > 5000 ? '...' : ''}

Generate a clear, actionable prompt that will guide the worker agent to complete the task according to the definition of done. The prompt should:
1. Be specific about what needs to be done
2. Reference the definition of done
3. Address any gaps identified in the completion check
4. Be concise but complete

Return ONLY the prompt text, no explanations, no JSON, just the prompt that should be given to the worker agent.`;

    try {
      const executeOptions: ExecuteCommandOptions = { cwd };
      if (timeout) {
        executeOptions.timeout = timeout;
      }

      // IMPORTANT: This call to cursor for prompt generation is NOT recorded in conversation history.
      // The review agent's internal calls should not pollute the conversation context.
      const result = await this.cursorCLI.executeCommand(
        ['--print', '--force', promptGenerationPrompt],
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

    // Default definition of done for code writing tasks (used as fallback)
    const codeWritingDefinitionOfDone =
      'A Pull Request was created OR code was pushed to origin with the task complete';

    // Use custom definition if provided, otherwise will let cursor choose from defaults
    const definitionToUse = definitionOfDone;

    // Always check git completion status (will be relevant for code writing tasks)
    let completionCheck: CompletionCheckResult;
    try {
      completionCheck = this.gitCompletionChecker.checkCompletion(
        cwd,
        definitionToUse || codeWritingDefinitionOfDone
      );
    } catch (error) {
      logger.warn('Failed to check git completion status', {
        error: getErrorMessage(error),
        cwd,
      });
      // Fallback: assume not complete if we can't check
      completionCheck = {
        isComplete: false,
        reason: 'Unable to check git completion status',
        hasPullRequest: false,
        hasPushedCommits: false,
      };
    }

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

If this is a CODE/FILE WRITING TASK (involves writing, creating, modifying, or implementing SOURCE CODE FILES that need to be committed to git), use this definition:
"A Pull Request was created OR code was pushed to origin with the task complete"

If this is a SIMPLE REQUEST/QUESTION, DATA OPERATION, or DATABASE TASK (asking questions, requesting information, explanations, clarifications, database queries/updates, data manipulation, executing scripts/commands that don't create source code files, etc.), use this definition:
"The request was completed or the question was answered"

IMPORTANT TASK TYPE GUIDELINES:
- Database operations (SQL queries, updates, inserts, deletes) are NOT code writing tasks
- Data manipulation tasks are NOT code writing tasks
- Executing commands/scripts to perform operations (without creating source code files) are NOT code writing tasks
- Tasks that only involve reading, querying, or updating data are NOT code writing tasks
- Only tasks that create/modify SOURCE CODE FILES (that should be committed to git) are code writing tasks

You must determine which type of task this is and apply the appropriate definition of done.

`
}COMPLETION STATUS CHECK:
- Has Pull Request: ${completionCheck.hasPullRequest}
- Has Pushed Commits: ${completionCheck.hasPushedCommits}
- Git Check Result: ${completionCheck.isComplete ? 'Complete' : 'Not Complete'}
- Reason: ${completionCheck.reason}

IMPORTANT COMPLETION RULES:
- The task is complete ONLY if it meets the definition of done criteria
- If the agent reports that the project/task was already done before the task was initiated, mark code_complete: true (the task is considered complete since the desired state already exists)
- For code/file writing tasks: If the definition of done requires a Pull Request or code pushed to origin, check the completion status above. The task is NOT complete unless PR is created OR code is pushed to origin.
- For simple requests/questions: The task is complete if the request was fulfilled or the question was answered adequately. No git operations are required.
- If the output is a simple text response (greeting, answer to a question, conversational reply) AND it's a simple request/question, mark code_complete: true
- If the output is asking a question or requesting clarification, mark code_complete: true
- If the output contains code changes, file modifications for a code writing task, but does NOT meet definition of done (no PR, code not pushed), mark code_complete: false
- If the output is just informational, explanatory, or a direct response without code/commands AND it's a simple request/question, mark code_complete: true
- If the output indicates the task is complete and meets definition of done, mark code_complete: true
- If the output shows work was done for a code writing task but definition of done is not met (e.g., no PR created, code not pushed), mark code_complete: false

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
      // Model selection is handled automatically by cursor-cli when --model flag is omitted
      // IMPORTANT: This call to cursor is NOT recorded in conversation history.
      // The review agent's calls are internal and should not pollute the conversation context.
      const result = await this.cursorCLI.executeCommand(
        ['--print', '--force', reviewPrompt],
        executeOptions
      );

      // Clean the output - remove ANSI escape sequences and trim whitespace
      // eslint-disable-next-line no-control-regex
      const ansiEscapeRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
      const cleanedOutput = result.stdout
        .replace(ansiEscapeRegex, '') // Remove ANSI escape codes
        .replace(/\r\n/g, '\n') // Normalize line endings
        .trim();

      // Try to find JSON object in the output
      // First, try to find a complete JSON object by matching braces
      const jsonStart = cleanedOutput.indexOf('{');
      if (jsonStart === -1) {
        logger.warn('No JSON object found in review output', {
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput };
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
        return { result: null, rawOutput: cleanedOutput };
      }

      // Extract the JSON substring
      const jsonString = cleanedOutput.substring(jsonStart, jsonEnd);

      try {
        const parsed = JSON.parse(jsonString) as Partial<ReviewResult>;
        // Validate required fields
        if (typeof parsed.code_complete !== 'boolean') {
          logger.warn('Review JSON missing required fields', { parsed });
          return { result: null, rawOutput: cleanedOutput };
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
              definitionToUse || codeWritingDefinitionOfDone,
              completionCheck,
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
          rawOutput: cleanedOutput,
        };
      } catch (parseError) {
        const error = parseError instanceof Error ? parseError : new Error(String(parseError));
        logger.warn('Failed to parse review JSON', {
          error: error.message,
          jsonString: jsonString.substring(0, 200),
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput };
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('Review agent failed', { error: errorMessage });
      // Return error message as raw output
      return {
        result: null,
        rawOutput: `Review agent error: ${errorMessage}`,
      };
    }
  }
}
