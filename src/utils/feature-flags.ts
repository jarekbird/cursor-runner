/**
 * Feature flag utilities for controlling feature visibility.
 */
import { logger } from '../logger.js';

/**
 * Check if ElevenLabs agent feature is enabled.
 * Reads from ELEVENLABS_AGENT_ENABLED environment variable.
 * Defaults to false if not set.
 * 
 * @returns true if the feature is enabled, false otherwise
 */
export function isElevenLabsEnabled(): boolean {
  const flag = process.env.ELEVENLABS_AGENT_ENABLED;
  const enabled = flag === 'true' || flag === 'True' || flag === 'TRUE';
  
  if (!enabled && flag !== undefined && flag !== 'false' && flag !== 'False' && flag !== 'FALSE') {
    logger.warn('ELEVENLABS_AGENT_ENABLED has unexpected value', {
      value: flag,
      note: 'Feature will be disabled. Expected "true" or "false"',
    });
  }
  
  return enabled;
}

/**
 * Check if a callback URL is for the ElevenLabs agent service.
 * @param callbackUrl - The callback URL to check
 * @returns true if the URL appears to be for ElevenLabs agent service
 */
export function isElevenLabsCallbackUrl(callbackUrl: string): boolean {
  try {
    const url = new URL(callbackUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    
    // Check if hostname contains elevenlabs-agent or if pathname contains /callback
    // and hostname matches known ElevenLabs agent service patterns
    return (
      hostname.includes('elevenlabs-agent') ||
      (pathname.includes('/callback') && hostname.includes('elevenlabs'))
    );
  } catch {
    // If URL parsing fails, assume it's not an ElevenLabs URL
    return false;
  }
}

/**
 * Check if a callback should be sent to ElevenLabs agent.
 * Logs a warning if the feature is disabled and the URL is for ElevenLabs.
 * 
 * @param callbackUrl - The callback URL to check
 * @returns true if the callback should be sent, false if it should be skipped
 */
export function shouldSendElevenLabsCallback(callbackUrl: string): boolean {
  if (!isElevenLabsCallbackUrl(callbackUrl)) {
    // Not an ElevenLabs URL, allow it
    return true;
  }
  
  const enabled = isElevenLabsEnabled();
  if (!enabled) {
    logger.info('ElevenLabs agent feature is disabled, skipping callback', {
      callbackUrl: callbackUrl.replace(/secret=[^&]*/, 'secret=***'), // Mask secret in logs
      note: 'Set ELEVENLABS_AGENT_ENABLED=true to enable',
    });
    return false;
  }
  
  return true;
}

