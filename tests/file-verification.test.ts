/**
 * File Verification Tests
 * 
 * These tests verify that key source files exist and have the expected structure
 * as documented in the master plan.
 */

// eslint-disable-next-line node/no-unpublished-import
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

describe('File Verification (TASK-PY-001.03)', () => {
  const srcDir = path.join(process.cwd(), 'src');

  describe('Key source files exist', () => {
    const keyFiles = [
      'server.ts',
      'cursor-execution-service.ts',
      'cursor-cli.ts',
      'conversation-service.ts',
      'system-settings.ts',
    ];

    keyFiles.forEach((file) => {
      it(`should have ${file}`, () => {
        const filePath = path.join(srcDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });
  });

  describe('server.ts structure', () => {
    it('should contain Express server implementation', () => {
      const content = fs.readFileSync(path.join(srcDir, 'server.ts'), 'utf-8');
      expect(content).toMatch(/express/i);
      expect(content).toMatch(/class Server/i);
    });

    it('should have health endpoint', () => {
      const content = fs.readFileSync(path.join(srcDir, 'server.ts'), 'utf-8');
      expect(content).toMatch(/\/health/i);
    });

    it('should have cursor execution endpoints', () => {
      const content = fs.readFileSync(path.join(srcDir, 'server.ts'), 'utf-8');
      expect(content).toMatch(/\/cursor\/execute/i);
      expect(content).toMatch(/\/cursor\/iterate/i);
    });
  });

  describe('cursor-execution-service.ts structure', () => {
    it('should have execute method', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'cursor-execution-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/execute\s*\(/i);
    });

    it('should have iterate method', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'cursor-execution-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/iterate\s*\(/i);
    });

    it('should have CursorExecutionService class', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'cursor-execution-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/class CursorExecutionService/i);
    });
  });

  describe('cursor-cli.ts structure', () => {
    it('should have CursorCLI class', () => {
      const content = fs.readFileSync(path.join(srcDir, 'cursor-cli.ts'), 'utf-8');
      expect(content).toMatch(/class CursorCLI/i);
    });

    it('should have Semaphore class for concurrency', () => {
      const content = fs.readFileSync(path.join(srcDir, 'cursor-cli.ts'), 'utf-8');
      expect(content).toMatch(/class Semaphore/i);
    });

    it('should have timeout handling', () => {
      const content = fs.readFileSync(path.join(srcDir, 'cursor-cli.ts'), 'utf-8');
      expect(content).toMatch(/timeout/i);
    });
  });

  describe('conversation-service.ts structure', () => {
    it('should have ConversationService class', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'conversation-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/class ConversationService/i);
    });

    it('should have Redis integration', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'conversation-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/ioredis|Redis/i);
    });

    it('should have getConversationId method', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'conversation-service.ts'),
        'utf-8'
      );
      expect(content).toMatch(/getConversationId/i);
    });
  });

  describe('system-settings.ts structure', () => {
    it('should have isSystemSettingEnabled function', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'system-settings.ts'),
        'utf-8'
      );
      expect(content).toMatch(/isSystemSettingEnabled/i);
    });

    it('should have database connection logic', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'system-settings.ts'),
        'utf-8'
      );
      expect(content).toMatch(/better-sqlite3|Database/i);
    });

    it('should have Gmail configuration functions', () => {
      const content = fs.readFileSync(
        path.join(srcDir, 'system-settings.ts'),
        'utf-8'
      );
      expect(content).toMatch(/getGmail/i);
    });
  });
});

