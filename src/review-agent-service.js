import { logger } from './logger.js';

/**
 * ReviewAgentService - Uses cursor as a review agent to evaluate code completion
 *
 * Analyzes cursor output to determine if code generation is complete.
 */
export class ReviewAgentService {
  constructor(cursorCLI) {
    this.cursorCLI = cursorCLI;
  }

  /**
   * Review output using cursor as a review agent
   * @param {string} output - Output to review
   * @param {string} cwd - Working directory
   * @param {number} [timeout] - Optional timeout override
   * @returns {Promise<Object>} Review result with parsed result and raw output
   *   - result: Parsed review result or null if parsing failed
   *   - rawOutput: Raw output from review agent
   */
  async reviewOutput(output, cwd, timeout = null) {
    const reviewPrompt = `You are a review agent. Your job is to evaluate the previous agent's output and return ONLY a valid JSON object with no additional text, explanations, or formatting. 

CRITICAL: You must return ONLY the JSON object, nothing else. No explanations, no markdown, no code blocks, just the raw JSON.

Evaluate whether the task was completed and if there are permission issues that require breaking iterations.

IMPORTANT COMPLETION RULES:
- If the output is a simple text response (greeting, answer to a question, conversational reply), mark code_complete: true
- If the output is asking a question or requesting clarification, mark code_complete: true
- If the output contains code changes, file modifications, or indicates work is still in progress, mark code_complete: false
- If the output is just informational, explanatory, or a direct response without code/commands, mark code_complete: true
- If the output indicates the task is complete and no further work is needed, mark code_complete: true

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
  "justification": "Task completed successfully"
}

Previous agent output:
${output}`;

    try {
      const options = { cwd };
      if (timeout) {
        options.timeout = timeout;
      }
      // Use --print for non-interactive mode (required for automation)
      const result = await this.cursorCLI.executeCommand(
        ['--print', '--resume', reviewPrompt],
        options
      );

      // Clean the output - remove ANSI escape sequences and trim whitespace
      // eslint-disable-next-line no-control-regex
      const ansiEscapeRegex = /\u001b\[[0-9;]*[a-zA-Z]/g;
      let cleanedOutput = result.stdout
        .replace(ansiEscapeRegex, '') // Remove ANSI escape codes
        .replace(/\r\n/g, '\n') // Normalize line endings
        .trim();

      // Try to find JSON object in the output
      // First, try to find a complete JSON object by matching braces
      let jsonStart = cleanedOutput.indexOf('{');
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
        const parsed = JSON.parse(jsonString);
        // Validate required fields
        if (typeof parsed.code_complete !== 'boolean') {
          logger.warn('Review JSON missing required fields', { parsed });
          return { result: null, rawOutput: cleanedOutput };
        }
        // Set break_iteration default to false if not provided
        if (typeof parsed.break_iteration !== 'boolean') {
          parsed.break_iteration = false;
        }
        return { result: parsed, rawOutput: cleanedOutput };
      } catch (parseError) {
        logger.warn('Failed to parse review JSON', {
          error: parseError.message,
          jsonString: jsonString.substring(0, 200),
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return { result: null, rawOutput: cleanedOutput };
      }
    } catch (error) {
      logger.error('Review agent failed', { error: error.message });
      // Return error message as raw output
      return { result: null, rawOutput: `Review agent error: ${error.message}` };
    }
  }
}
