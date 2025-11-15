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
   * @param command - Command string
   * @returns Command arguments
   */
  parseCommand(command: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar: string | null = null;

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
   * @param commandArgs - Command arguments
   * @param instructions - Instructions to append
   * @returns Modified arguments
   */
  appendInstructions(commandArgs: string[], instructions: string): string[] {
    const modifiedArgs = [...commandArgs];
    let foundPromptFlag = false;

    // Flags that might appear between the prompt flag and the actual prompt text
    const skipFlags: string[] = ['--force', '--resume', '--dry-run', '--verbose', '--quiet'];

    for (let i = 0; i < modifiedArgs.length; i++) {
      // Common prompt flags: --print, --prompt, -p, --instruction, --message, etc.
      if (
        modifiedArgs[i] === '--print' ||
        modifiedArgs[i] === '--prompt' ||
        modifiedArgs[i] === '-p' ||
        modifiedArgs[i] === '--instruction' ||
        modifiedArgs[i] === '--message'
      ) {
        // Find the next non-flag argument (the prompt text)
        // Skip over flags like --force, --resume, etc.
        let promptIndex = i + 1;
        while (promptIndex < modifiedArgs.length && skipFlags.includes(modifiedArgs[promptIndex])) {
          promptIndex++;
        }

        if (promptIndex < modifiedArgs.length) {
          // Append instructions to the prompt text
          modifiedArgs[promptIndex] = modifiedArgs[promptIndex] + instructions;
          foundPromptFlag = true;
          break;
        }
      }
    }

    // If no prompt flag found, append instructions to the last argument
    if (!foundPromptFlag && modifiedArgs.length > 0) {
      modifiedArgs[modifiedArgs.length - 1] = modifiedArgs[modifiedArgs.length - 1] + instructions;
    }

    return modifiedArgs;
  }
}
