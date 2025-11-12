/**
 * CommandParserService - Parses and manipulates command strings
 *
 * Handles parsing command strings into argument arrays and appending
 * instructions to commands.
 */
export class CommandParserService {
  /**
   * Parse command string into arguments array
   * Handles quoted arguments and spaces
   * @param {string} command - Command string
   * @returns {Array<string>} Command arguments
   */
  parseCommand(command) {
    const args = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = null;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if ((char === '"' || char === "'") && (i === 0 || command[i - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        } else {
          current += char;
        }
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  /**
   * Append instructions to command arguments
   * @param {Array<string>} commandArgs - Command arguments
   * @param {string} instructions - Instructions to append
   * @returns {Array<string>} Modified arguments
   */
  appendInstructions(commandArgs, instructions) {
    const modifiedArgs = [...commandArgs];
    let foundPromptFlag = false;

    for (let i = 0; i < modifiedArgs.length; i++) {
      // Common prompt flags: --prompt, -p, --instruction, --message, etc.
      if (
        (modifiedArgs[i] === '--prompt' ||
          modifiedArgs[i] === '-p' ||
          modifiedArgs[i] === '--instruction' ||
          modifiedArgs[i] === '--message') &&
        i + 1 < modifiedArgs.length
      ) {
        // Append instructions to the next argument (the prompt text)
        modifiedArgs[i + 1] = modifiedArgs[i + 1] + instructions;
        foundPromptFlag = true;
        break;
      }
    }

    // If no prompt flag found, append instructions to the last argument
    if (!foundPromptFlag && modifiedArgs.length > 0) {
      modifiedArgs[modifiedArgs.length - 1] = modifiedArgs[modifiedArgs.length - 1] + instructions;
    }

    return modifiedArgs;
  }
}
