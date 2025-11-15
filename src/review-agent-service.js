import { logger } from './logger.js';

/**
 * ReviewAgentService - Uses cursor as a review agent to evaluate code completion
 *
 * Analyzes cursor output to determine if code generation is complete
 * and if terminal commands need to be executed.
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
   * @returns {Promise<Object|null>} Review result or null if parsing failed
   */
  async reviewOutput(output, cwd, timeout = null) {
    const reviewPrompt = `You are a review agent. Your job is to evaluate the previous agent's output and return ONLY a valid JSON object with no additional text, explanations, or formatting. 

CRITICAL: You must return ONLY the JSON object, nothing else. No explanations, no markdown, no code blocks, just the raw JSON.

Evaluate whether the task was completed and whether a terminal command has been requested by the agent to be run. If a terminal request is being requested, mark the output as code_complete: false. If the output is not requesting a terminal request, but simply asking a question, set code_complete to true and execute_terminal_command to false.

Return ONLY this JSON structure (no other text):

{
  "code_complete": true,
  "execute_terminal_command": true,
  "terminal_command_requested": "bundle exec rspec spec",
  "justification": "step 3 was skipped"
}

Previous agent output:
${output}`;

    try {
      const options = { cwd };
      if (timeout) {
        options.timeout = timeout;
      }
      const result = await this.cursorCLI.executeCommand(['--print', reviewPrompt], options);

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
        return null;
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
        return null;
      }

      // Extract the JSON substring
      const jsonString = cleanedOutput.substring(jsonStart, jsonEnd);

      try {
        const parsed = JSON.parse(jsonString);
        // Validate required fields
        if (
          typeof parsed.code_complete !== 'boolean' ||
          typeof parsed.execute_terminal_command !== 'boolean'
        ) {
          logger.warn('Review JSON missing required fields', { parsed });
          return null;
        }
        return parsed;
      } catch (parseError) {
        logger.warn('Failed to parse review JSON', {
          error: parseError.message,
          jsonString: jsonString.substring(0, 200),
          outputPreview: cleanedOutput.substring(0, 200),
        });
        return null;
      }
    } catch (error) {
      logger.error('Review agent failed', { error: error.message });
      return null;
    }
  }
}
