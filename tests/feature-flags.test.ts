import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  isElevenLabsEnabled,
  isElevenLabsCallbackUrl,
  shouldSendElevenLabsCallback,
} from '../src/utils/feature-flags';
import { logger } from '../src/logger.js';

describe('Feature Flags', () => {
  const originalEnv = process.env.ELEVENLABS_AGENT_ENABLED;

  beforeEach(() => {
    delete process.env.ELEVENLABS_AGENT_ENABLED;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ELEVENLABS_AGENT_ENABLED = originalEnv;
    } else {
      delete process.env.ELEVENLABS_AGENT_ENABLED;
    }
  });

  describe('isElevenLabsEnabled', () => {
    let loggerWarnSpy: jest.SpiedFunction<typeof logger.warn>;

    beforeEach(() => {
      loggerWarnSpy = jest.spyOn(logger, 'warn');
    });

    afterEach(() => {
      loggerWarnSpy.mockRestore();
    });

    it('returns false when flag is not set', () => {
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns false when flag is "false"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns false when flag is "False"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'False';
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns false when flag is "FALSE"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'FALSE';
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns true when flag is "true"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'true';
      expect(isElevenLabsEnabled()).toBe(true);
    });

    it('returns true when flag is "True"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'True';
      expect(isElevenLabsEnabled()).toBe(true);
    });

    it('returns true when flag is "TRUE"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'TRUE';
      expect(isElevenLabsEnabled()).toBe(true);
    });

    it('logs warning for invalid values', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'invalid';
      expect(isElevenLabsEnabled()).toBe(false);

      expect(loggerWarnSpy).toHaveBeenCalled();
      const warnCalls = loggerWarnSpy.mock.calls;
      const hasInvalidValueWarning = warnCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('ELEVENLABS_AGENT_ENABLED has unexpected value');
      });
      expect(hasInvalidValueWarning).toBe(true);
    });

    it('does not log warning for valid false values', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      isElevenLabsEnabled();
      loggerWarnSpy.mockClear();

      process.env.ELEVENLABS_AGENT_ENABLED = 'False';
      isElevenLabsEnabled();
      loggerWarnSpy.mockClear();

      process.env.ELEVENLABS_AGENT_ENABLED = 'FALSE';
      isElevenLabsEnabled();

      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('isElevenLabsCallbackUrl', () => {
    it('returns true for elevenlabs-agent hostname', () => {
      expect(isElevenLabsCallbackUrl('http://elevenlabs-agent:3004/callback')).toBe(true);
    });

    it('returns true for hostname containing elevenlabs-agent', () => {
      expect(isElevenLabsCallbackUrl('https://elevenlabs-agent.example.com/callback')).toBe(true);
    });

    it('returns true for callback path with elevenlabs in hostname', () => {
      expect(isElevenLabsCallbackUrl('http://elevenlabs.example.com/callback')).toBe(true);
    });

    it('returns false for non-ElevenLabs URLs', () => {
      expect(isElevenLabsCallbackUrl('http://other-service:3000/callback')).toBe(false);
    });

    it('returns false for invalid URLs', () => {
      expect(isElevenLabsCallbackUrl('not-a-url')).toBe(false);
    });
  });

  describe('shouldSendElevenLabsCallback', () => {
    let loggerInfoSpy: jest.SpiedFunction<typeof logger.info>;

    beforeEach(() => {
      loggerInfoSpy = jest.spyOn(logger, 'info');
    });

    afterEach(() => {
      loggerInfoSpy.mockRestore();
    });

    it('returns true for non-ElevenLabs URLs even when flag is disabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(shouldSendElevenLabsCallback('http://other-service:3000/callback')).toBe(true);
      expect(loggerInfoSpy).not.toHaveBeenCalled();
    });

    it('returns false for ElevenLabs URLs when flag is disabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(shouldSendElevenLabsCallback('http://elevenlabs-agent:3004/callback')).toBe(false);
    });

    it('returns true for ElevenLabs URLs when flag is enabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'true';
      expect(shouldSendElevenLabsCallback('http://elevenlabs-agent:3004/callback')).toBe(true);
      expect(loggerInfoSpy).not.toHaveBeenCalled();
    });

    it('logs when feature is disabled and URL is for ElevenLabs', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      shouldSendElevenLabsCallback('http://elevenlabs-agent:3004/callback');

      expect(loggerInfoSpy).toHaveBeenCalled();
      const infoCalls = loggerInfoSpy.mock.calls;
      const hasSkippingMessage = infoCalls.some((call) => {
        const arg = call[0] as unknown;
        return typeof arg === 'string' && arg.includes('ElevenLabs agent feature is disabled, skipping callback');
      });
      expect(hasSkippingMessage).toBe(true);
    });

    it('masks secrets in logs', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      const callbackUrl = 'http://elevenlabs-agent:3004/callback?secret=my-secret-key-123';
      shouldSendElevenLabsCallback(callbackUrl);

      expect(loggerInfoSpy).toHaveBeenCalled();
      const infoCalls = loggerInfoSpy.mock.calls;
      const hasMaskedSecret = infoCalls.some((call) => {
        // Check if any call contains the masked secret pattern
        const callStr = JSON.stringify(call);
        return callStr.includes('secret=***') && !callStr.includes('my-secret-key-123');
      });
      expect(hasMaskedSecret).toBe(true);
    });
  });
});
