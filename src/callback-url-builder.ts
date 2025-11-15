/**
 * Helper module for constructing callback URLs
 */

import { logger } from './logger.js';

/**
 * Construct callback URL from environment variables or Docker network defaults
 * Uses JAREK_VA_URL if set, otherwise defaults to Docker service name (app:3000)
 * In Docker networks, services can communicate using service names as hostnames.
 * The jarek-va service is named 'app' in docker-compose.yml, so we default to http://app:3000
 * Adds WEBHOOK_SECRET as query parameter if available
 * @returns Constructed callback URL (always returns a URL, defaults to Docker network)
 */
export function buildCallbackUrl(): string {
  // Get jarek-va URL from environment, or use Docker network default
  // In Docker Compose networks, services communicate using service names as hostnames
  // The jarek-va service is consistently named 'app' in docker-compose.yml
  const jarekVaUrl = process.env.JAREK_VA_URL || 'http://app:3000';

  if (!process.env.JAREK_VA_URL) {
    logger.debug('JAREK_VA_URL not set, using Docker network default', {
      defaultUrl: jarekVaUrl,
      note: 'Using service name from Docker network (app:3000)',
    });
  }

  // Construct callback URL
  const callbackUrl = new URL('/cursor-runner/callback', jarekVaUrl);

  // Add webhook secret as query parameter if available
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    callbackUrl.searchParams.set('secret', webhookSecret);
  }

  const finalUrl = callbackUrl.toString();
  logger.debug('Constructed callback URL', {
    jarekVaUrl,
    webhookSecret: webhookSecret ? '***' : 'not set',
    callbackUrl: finalUrl,
    source: process.env.JAREK_VA_URL ? 'JAREK_VA_URL env var' : 'Docker network default (app:3000)',
  });

  return finalUrl;
}

/**
 * Get webhook secret from environment
 * @returns Webhook secret or null if not set
 */
export function getWebhookSecret(): string | null {
  return process.env.WEBHOOK_SECRET || null;
}
