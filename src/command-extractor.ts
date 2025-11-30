/**
 * CommandExtractor - Extracts terminal commands from cursor-cli output
 *
 * Parses cursor-cli stdout to identify and extract terminal commands
 * that the AI agent is executing (e.g., npm test, git commit, etc.)
 */

/**
 * Extract commands from cursor-cli output
 * Looks for patterns like:
 * - Code blocks with ```bash, ```sh, ```shell
 * - Lines starting with $ or > (command prompts)
 * - Lines that look like shell commands
 *
 * @param output - The stdout/stderr from cursor-cli
 * @returns Array of extracted commands with context
 */
export function extractCommands(output: string): Array<{
  command: string;
  lineNumber: number;
  context: string;
}> {
  const commands: Array<{ command: string; lineNumber: number; context: string }> = [];
  const lines = output.split('\n');

  let inCodeBlock = false;
  let codeBlockLanguage = '';
  let codeBlockStart = 0;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for code block start/end
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block - extract commands from it
        const language = codeBlockLanguage.toLowerCase();
        if (language === 'bash' || language === 'sh' || language === 'shell' || language === '') {
          for (const codeLine of codeBlockLines) {
            const command = extractCommandFromLine(codeLine);
            if (command) {
              commands.push({
                command,
                lineNumber: codeBlockStart + codeBlockLines.indexOf(codeLine),
                context: `Code block (${codeBlockLanguage || 'shell'})`,
              });
            }
          }
        }
        inCodeBlock = false;
        codeBlockLanguage = '';
        codeBlockLines = [];
      } else {
        // Start of code block
        inCodeBlock = true;
        codeBlockStart = i;
        codeBlockLanguage = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Look for command prompts ($, >, #)
    if (/^[$#>]\s+/.test(trimmed)) {
      const command = trimmed.replace(/^[$#>]\s+/, '').trim();
      if (command && !isLikelyOutput(command)) {
        commands.push({
          command,
          lineNumber: i,
          context: 'Command prompt',
        });
      }
      continue;
    }

    // Look for standalone commands (lines that look like shell commands)
    if (isLikelyCommand(trimmed) && !isLikelyOutput(trimmed)) {
      commands.push({
        command: trimmed,
        lineNumber: i,
        context: 'Standalone command',
      });
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    const language = codeBlockLanguage.toLowerCase();
    if (language === 'bash' || language === 'sh' || language === 'shell' || language === '') {
      for (const codeLine of codeBlockLines) {
        const command = extractCommandFromLine(codeLine);
        if (command) {
          commands.push({
            command,
            lineNumber: codeBlockStart + codeBlockLines.indexOf(codeLine),
            context: `Code block (${codeBlockLanguage || 'shell'})`,
          });
        }
      }
    }
  }

  return commands;
}

/**
 * Extract command from a line (removes comments, handles multi-line)
 */
function extractCommandFromLine(line: string): string | null {
  const trimmed = line.trim();

  // Skip empty lines
  if (!trimmed) return null;

  // Skip comments
  if (trimmed.startsWith('#')) return null;

  // Remove trailing comments
  const withoutComment = trimmed.split('#')[0].trim();

  // Skip if it's just whitespace or comment
  if (!withoutComment) return null;

  // Remove command prompt characters if present
  const cleaned = withoutComment.replace(/^[$#>]\s+/, '').trim();

  return cleaned || null;
}

/**
 * Check if a line looks like a command (not output)
 */
function isLikelyCommand(line: string): boolean {
  const trimmed = line.trim();

  // Must not be empty
  if (!trimmed) return false;

  // Must not start with common output indicators
  if (/^(Running|Executing|Error|Warning|Success|Failed|✓|✗|→|│)/i.test(trimmed)) {
    return false;
  }

  // Must not be just punctuation or symbols
  if (/^[^\w]+\s*$/.test(trimmed)) return false;

  // Must contain at least one word character
  if (!/\w/.test(trimmed)) return false;

  // Common command patterns
  const commandPatterns = [
    /^(npm|yarn|pnpm|bun)\s+/,
    /^git\s+/,
    /^cd\s+/,
    /^ls\s*/,
    /^cat\s+/,
    /^grep\s+/,
    /^find\s+/,
    /^mkdir\s+/,
    /^rm\s+/,
    /^mv\s+/,
    /^cp\s+/,
    /^chmod\s+/,
    /^chown\s+/,
    /^curl\s+/,
    /^wget\s+/,
    /^python\s+/,
    /^node\s+/,
    /^tsx\s+/,
    /^tsc\s+/,
    /^jest\s+/,
    /^vitest\s+/,
    /^pytest\s+/,
    /^bundle\s+exec/,
    /^rails\s+/,
    /^docker\s+/,
    /^kubectl\s+/,
    /^\.\/[^\s]+/, // Script execution
    /^[A-Z_]+=/, // Environment variable assignment
  ];

  return commandPatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Check if a line looks like output (not a command)
 */
function isLikelyOutput(line: string): boolean {
  const trimmed = line.trim();

  // Empty lines are not commands
  if (!trimmed) return true;

  // Lines that are clearly output
  const outputPatterns = [
    /^(Running|Executing|Error|Warning|Success|Failed|✓|✗|→|│|PASS|FAIL|✓|✗)/i,
    /^\d+\s+(passed|failed|skipped)/i,
    /^Test\s+Suites?:/i,
    /^Tests?:/i,
    /^Snapshots?:/i,
    /^Time:/i,
    /^File\s+changed/i,
    /^On\s+branch/i,
    /^Your\s+branch/i,
    /^Changes\s+not\s+staged/i,
    /^Untracked\s+files/i,
    /^nothing\s+to\s+commit/i,
    /^\[.*\]/, // Bracketed output
    /^\{.*\}/, // JSON-like output
  ];

  return outputPatterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Format extracted commands for display
 */
export function formatCommandsForDisplay(
  commands: Array<{ command: string; lineNumber: number; context: string }>
): string {
  if (commands.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('\n--- Commands Executed by Cursor Agent ---\n');

  for (const cmd of commands) {
    lines.push(`[Line ${cmd.lineNumber}] ${cmd.context}:`);
    lines.push(`  $ ${cmd.command}`);
    lines.push('');
  }

  lines.push('--- End of Commands ---\n');

  return lines.join('\n');
}
