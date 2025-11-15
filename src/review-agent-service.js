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
   * @returns {Promise<Object|null>} Review result or null if parsing failed
   */
  async reviewOutput(output, cwd) {
    // Quick check: if output is empty, it's likely incomplete
    if (!output || output.trim().length === 0) {
      logger.debug('Output is empty, marking as incomplete', { cwd });
      return {
        code_complete: false,
        execute_terminal_command: false,
        terminal_command_requested: null,
        justification: 'Output is empty',
      };
    }

    const reviewPrompt = `You are a review agent. Your job is to evaluate the previous agent's output and return a simple JSON parsable output with a simple structure defining whether the task was completed. Also evaluate whether a terminal command has been requested by the agent to be run. If a terminal request is being requested, mark the output as code_complete: false. If the output is not requesting a terminal request, but simply asking a question, set code_complete to true and execute_terminal_command to false. Return following the pattern of this shape:

{
  "code_complete": true,
  "execute_terminal_command": true,
  "terminal_command_requested": "bundle exec rspec spec",
  "justification": "step 3 was skipped"
}

Previous agent output:
${output}`;

    try {
      const result = await this.cursorCLI.executeCommand(['--print', reviewPrompt], {
        cwd,
      });

      // Extract all JSON objects by matching balanced braces
      const jsonMatches = [];
      let depth = 0;
      let start = -1;

      for (let i = 0; i < result.stdout.length; i++) {
        if (result.stdout[i] === '{') {
          if (depth === 0) {
            start = i;
          }
          depth++;
        } else if (result.stdout[i] === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            const jsonCandidate = result.stdout.substring(start, i + 1);
            try {
              const parsed = JSON.parse(jsonCandidate);
              jsonMatches.push(parsed);
            } catch (parseError) {
              // Not valid JSON, skip
            }
            start = -1;
          }
        }
      }

      if (jsonMatches.length > 0) {
        return jsonMatches[jsonMatches.length - 1];
      }

      // If no JSON found, try to parse the entire output
      try {
        return JSON.parse(result.stdout);
      } catch (parseError) {
        logger.warn('Failed to parse review output as JSON', { error: parseError.message });
        return null;
      }
    } catch (error) {
      logger.error('Review agent failed', { error: error.message });
      return null;
    }
  }
}
