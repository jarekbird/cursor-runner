import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger.js';
import { FilesystemService } from './filesystem-service.js';

/**
 * WorkspaceTrustService - Ensures workspace trust is configured
 *
 * Creates .vscode/settings.json with workspace trust enabled
 * to allow cursor-cli to execute commands like git.
 */
export class WorkspaceTrustService {
  constructor(filesystem = null) {
    this.filesystem = filesystem || new FilesystemService();
  }

  /**
   * Ensure workspace trust is configured for a given directory
   * @param {string} workspacePath - Path to the workspace directory
   * @returns {Promise<void>}
   */
  async ensureWorkspaceTrust(workspacePath) {
    try {
      // Create .vscode directory if it doesn't exist
      const vscodeDir = join(workspacePath, '.vscode');
      if (!this.filesystem.exists(vscodeDir)) {
        await mkdir(vscodeDir, { recursive: true });
        logger.info('Created .vscode directory', { workspacePath });
      }

      // Create or update settings.json with workspace trust enabled
      const settingsPath = join(vscodeDir, 'settings.json');
      let settings = {};

      // Read existing settings if file exists
      if (this.filesystem.exists(settingsPath)) {
        try {
          const existingContent = await readFile(settingsPath, 'utf-8');
          settings = JSON.parse(existingContent);
        } catch (error) {
          logger.warn('Failed to read existing settings.json, creating new one', {
            workspacePath,
            error: error.message,
          });
        }
      }

      // Ensure workspace trust is enabled
      // For VS Code/Cursor, workspace trust is managed via security.workspace.trust settings
      // We need to configure these settings to allow cursor-cli to execute commands
      const trustSettings = {
        'security.workspace.trust.enabled': true,
        'security.workspace.trust.startupPrompt': 'never',
        'security.workspace.trust.untrustedFiles': 'open',
        'security.workspace.trust.banner': 'never',
        'security.workspace.trust.emptyWindow': true,
      };

      let needsUpdate = false;
      for (const [key, value] of Object.entries(trustSettings)) {
        if (settings[key] !== value) {
          settings[key] = value;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        // Write updated settings
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        logger.info('Configured workspace trust settings', { workspacePath, settingsPath });
      } else {
        logger.debug('Workspace trust already configured', { workspacePath });
      }

      // Also create .cursor directory with trust configuration if it doesn't exist
      const cursorDir = join(workspacePath, '.cursor');
      if (!this.filesystem.exists(cursorDir)) {
        await mkdir(cursorDir, { recursive: true });
        logger.info('Created .cursor directory', { workspacePath });
      }

      // Create cursor settings if needed
      const cursorSettingsPath = join(cursorDir, 'settings.json');
      if (!this.filesystem.exists(cursorSettingsPath)) {
        const cursorSettings = {
          'security.workspace.trust.enabled': true,
          'security.workspace.trust.startupPrompt': 'never',
          'security.workspace.trust.untrustedFiles': 'open',
        };
        await writeFile(
          cursorSettingsPath,
          JSON.stringify(cursorSettings, null, 2) + '\n',
          'utf-8'
        );
        logger.info('Created cursor workspace trust settings', {
          workspacePath,
          cursorSettingsPath,
        });
      }
    } catch (error) {
      logger.error('Failed to configure workspace trust', {
        workspacePath,
        error: error.message,
      });
      // Don't throw - we don't want to fail the entire operation
      // if workspace trust configuration fails
    }
  }
}
