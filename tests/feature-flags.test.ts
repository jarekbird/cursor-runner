import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  isElevenLabsEnabled,
  isElevenLabsCallbackUrl,
  shouldSendElevenLabsCallback,
} from '../src/utils/feature-flags';

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
    it('returns false when flag is not set', () => {
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns false when flag is "false"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(isElevenLabsEnabled()).toBe(false);
    });

    it('returns true when flag is "true"', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'true';
      expect(isElevenLabsEnabled()).toBe(true);
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
    it('returns true for non-ElevenLabs URLs even when flag is disabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(shouldSendElevenLabsCallback('http://other-service:3000/callback')).toBe(true);
    });

    it('returns false for ElevenLabs URLs when flag is disabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'false';
      expect(shouldSendElevenLabsCallback('http://elevenlabs-agent:3004/callback')).toBe(false);
    });

    it('returns true for ElevenLabs URLs when flag is enabled', () => {
      process.env.ELEVENLABS_AGENT_ENABLED = 'true';
      expect(shouldSendElevenLabsCallback('http://elevenlabs-agent:3004/callback')).toBe(true);
    });
  });
});
