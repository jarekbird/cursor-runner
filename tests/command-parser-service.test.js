// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CommandParserService } from '../src/command-parser-service.js';

describe('CommandParserService', () => {
  let parser;

  beforeEach(() => {
    parser = new CommandParserService();
  });

  describe('parseCommand', () => {
    it('should parse simple command without quotes', () => {
      const result = parser.parseCommand('cursor generate --prompt test');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test']);
    });

    it('should parse command with double quotes', () => {
      const result = parser.parseCommand('cursor generate --prompt "test message"');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test message']);
    });

    it('should parse command with single quotes', () => {
      const result = parser.parseCommand("cursor generate --prompt 'test message'");
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test message']);
    });

    it('should parse command with spaces in quoted arguments', () => {
      const result = parser.parseCommand(
        'cursor generate --prompt "create user service with authentication"'
      );
      expect(result).toEqual([
        'cursor',
        'generate',
        '--prompt',
        'create user service with authentication',
      ]);
    });

    it('should handle multiple quoted arguments', () => {
      const result = parser.parseCommand('cursor generate --prompt "test" --type "service"');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test', '--type', 'service']);
    });

    it('should handle mixed quotes', () => {
      const result = parser.parseCommand('cursor generate --prompt "test" --type \'service\'');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test', '--type', 'service']);
    });

    it('should handle escaped quotes', () => {
      // The parser treats escaped quotes as literal quotes (not as quote delimiters)
      // So "test\\"quote" becomes test\"quote (with literal backslash and quote)
      const result = parser.parseCommand('cursor generate --prompt "test\\"quote"');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test\\"quote']);
    });

    it('should handle empty string', () => {
      const result = parser.parseCommand('');
      expect(result).toEqual([]);
    });

    it('should handle command with only spaces', () => {
      const result = parser.parseCommand('   ');
      expect(result).toEqual([]);
    });

    it('should handle multiple spaces between arguments', () => {
      const result = parser.parseCommand('cursor    generate     --prompt    test');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'test']);
    });

    it('should handle quotes at start and end', () => {
      const result = parser.parseCommand('"quoted command"');
      expect(result).toEqual(['quoted command']);
    });

    it('should handle nested quotes', () => {
      const result = parser.parseCommand('cursor generate --prompt "outer \'inner\' quote"');
      expect(result).toEqual(['cursor', 'generate', '--prompt', "outer 'inner' quote"]);
    });

    it('should handle unclosed quotes', () => {
      const result = parser.parseCommand('cursor generate --prompt "unclosed quote');
      expect(result).toEqual(['cursor', 'generate', '--prompt', 'unclosed quote']);
    });

    it('should handle command with no arguments', () => {
      const result = parser.parseCommand('cursor');
      expect(result).toEqual(['cursor']);
    });

    it('should handle trailing space', () => {
      const result = parser.parseCommand('cursor generate ');
      expect(result).toEqual(['cursor', 'generate']);
    });

    it('should handle leading space', () => {
      const result = parser.parseCommand(' cursor generate');
      expect(result).toEqual(['cursor', 'generate']);
    });

    it('should parse command with --print --force flags', () => {
      const result = parser.parseCommand('cursor --print --force "test prompt"');
      expect(result).toEqual(['cursor', '--print', '--force', 'test prompt']);
    });

    it('should parse command with --resume --force flags', () => {
      const result = parser.parseCommand('cursor --resume --force "resume prompt"');
      expect(result).toEqual(['cursor', '--resume', '--force', 'resume prompt']);
    });
  });

  describe('appendInstructions', () => {
    it('should append instructions to --print flag', () => {
      const args = ['cursor', 'generate', '--print', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        'generate',
        '--print',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to --prompt flag', () => {
      const args = ['cursor', 'generate', '--prompt', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        'generate',
        '--prompt',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to -p flag', () => {
      const args = ['cursor', 'generate', '-p', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        'generate',
        '-p',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to --instruction flag', () => {
      const args = ['cursor', 'generate', '--instruction', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        'generate',
        '--instruction',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to --message flag', () => {
      const args = ['cursor', 'generate', '--message', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        'generate',
        '--message',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to prompt when --print --force is used', () => {
      const args = ['cursor', '--print', '--force', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        '--print',
        '--force',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append instructions to prompt when --resume --force is used', () => {
      const args = ['cursor', '--resume', '--force', 'original prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        '--resume',
        '--force',
        'original prompt\n\nAdditional instructions',
      ]);
    });

    it('should append to last argument when no prompt flag found', () => {
      const args = ['cursor', 'generate', 'test'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual(['cursor', 'generate', 'test\n\nAdditional instructions']);
    });

    it('should handle empty command array', () => {
      const args = [];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([]);
    });

    it('should use first prompt flag when multiple exist', () => {
      const args = ['cursor', '--prompt', 'first', '--prompt', 'second'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual([
        'cursor',
        '--prompt',
        'first\n\nAdditional instructions',
        '--prompt',
        'second',
      ]);
    });

    it('should handle prompt flag at the end without value', () => {
      const args = ['cursor', 'generate', '--prompt'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      // Should append to last argument since --prompt has no value
      expect(result).toEqual(['cursor', 'generate', '--prompt\n\nAdditional instructions']);
    });

    it('should handle single argument command', () => {
      const args = ['cursor'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      expect(result).toEqual(['cursor\n\nAdditional instructions']);
    });

    it('should not modify original array', () => {
      const args = ['cursor', 'generate', '--prompt', 'original'];
      const originalArgs = [...args];
      parser.appendInstructions(args, '\n\nInstructions');

      expect(args).toEqual(originalArgs);
    });

    it('should handle case-insensitive prompt flags', () => {
      // Note: Current implementation is case-sensitive, but test documents expected behavior
      const args = ['cursor', 'generate', '--PROMPT', 'original'];
      const instructions = '\n\nAdditional instructions';
      const result = parser.appendInstructions(args, instructions);

      // Since --PROMPT doesn't match --prompt, should append to last arg
      expect(result).toEqual([
        'cursor',
        'generate',
        '--PROMPT',
        'original\n\nAdditional instructions',
      ]);
    });
  });
});
