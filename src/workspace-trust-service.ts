import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';
import { FilesystemService } from './filesystem-service.js';

/**
 * VS Code/Cursor workspace trust settings
 */
interface WorkspaceTrustSettings {
  'security.workspace.trust.enabled'?: boolean;
  'security.workspace.trust.startupPrompt'?: string;
  'security.workspace.trust.untrustedFiles'?: string;
  'security.workspace.trust.banner'?: string;
  'security.workspace.trust.emptyWindow'?: boolean;
  [key: string]: unknown;
}

/**
 * Cursor CLI permissions configuration
 */
interface CLIPermissions {
  allow: string[];
  deny: string[];
}

/**
 * Cursor CLI configuration structure
 */
interface CLIConfig {
  permissions?: CLIPermissions;
  [key: string]: unknown;
}

/**
 * WorkspaceTrustService - Ensures workspace trust and cursor-cli permissions are configured
 *
 * Creates:
 * - .vscode/settings.json with workspace trust enabled
 * - .cursor/settings.json with cursor workspace trust settings
 * - .cursor/cli.json with cursor-cli permissions to allow shell commands and file operations
 *
 * This is required for cursor-cli to execute commands and file operations (like deletions)
 * without security restrictions. The permissions include:
 * - Shell commands (git, bash, rm, mv, cp, etc.)
 * - File system operations (delete, write, read)
 */
export class WorkspaceTrustService {
  private filesystem: FilesystemService;

  constructor(filesystem: FilesystemService | null = null) {
    this.filesystem = filesystem || new FilesystemService();
  }

  /**
   * Ensure workspace trust is configured for a given directory
   * @param workspacePath - Path to the workspace directory
   * @returns Promise that resolves when configuration is complete
   */
  async ensureWorkspaceTrust(workspacePath: string): Promise<void> {
    try {
      // Create .vscode directory if it doesn't exist
      const vscodeDir = join(workspacePath, '.vscode');
      if (!this.filesystem.exists(vscodeDir)) {
        await mkdir(vscodeDir, { recursive: true });
        logger.info('Created .vscode directory', { workspacePath });
      }

      // Create or update settings.json with workspace trust enabled
      const settingsPath = join(vscodeDir, 'settings.json');
      let settings: WorkspaceTrustSettings = {};

      // Read existing settings if file exists
      if (this.filesystem.exists(settingsPath)) {
        try {
          const existingContent = await readFile(settingsPath, 'utf-8');
          settings = JSON.parse(existingContent) as WorkspaceTrustSettings;
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.warn('Failed to read existing settings.json, creating new one', {
            workspacePath,
            error: errorMessage,
          });
        }
      }

      // Ensure workspace trust is enabled
      // For VS Code/Cursor, workspace trust is managed via security.workspace.trust settings
      // We need to configure these settings to allow cursor-cli to execute commands
      const trustSettings: WorkspaceTrustSettings = {
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
        const cursorSettings: WorkspaceTrustSettings = {
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

      // Create cursor-cli permissions configuration
      // This is required for cursor-cli to execute shell commands like git
      const cliConfigPath = join(cursorDir, 'cli.json');
      let cliConfig: CLIConfig = {};

      // Read existing cli.json if it exists
      if (this.filesystem.exists(cliConfigPath)) {
        try {
          const existingContent = await readFile(cliConfigPath, 'utf-8');
          cliConfig = JSON.parse(existingContent) as CLIConfig;
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          logger.warn('Failed to read existing cli.json, creating new one', {
            workspacePath,
            error: errorMessage,
          });
        }
      }

      // Ensure permissions are configured to allow git and shell commands
      if (!cliConfig.permissions) {
        cliConfig.permissions = {
          allow: [],
          deny: [],
        };
      }

      // Schema requires both 'allow' and 'deny' arrays
      if (!cliConfig.permissions.allow) {
        cliConfig.permissions.allow = [];
      }

      let permissionsUpdated = false;

      // Always ensure deny array exists (required by schema)
      // We'll keep it empty to allow all other commands
      if (!cliConfig.permissions.deny || !Array.isArray(cliConfig.permissions.deny)) {
        cliConfig.permissions.deny = [];
        permissionsUpdated = true; // Mark as updated so we write the file
      }

      // Add git and file operation permissions if not already present
      const requiredPermissions = [
        'Shell(git)',
        'Shell(bash)',
        'Shell(sh)',
        'Shell(chmod)',
        'Shell(echo)',
        'Shell(rm)',
        'Shell(rmdir)',
        'Shell(mv)',
        'Shell(cp)',
        'FileSystem(delete)',
        'FileSystem(write)',
        'FileSystem(read)',
      ] as const;

      for (const permission of requiredPermissions) {
        if (!cliConfig.permissions.allow.includes(permission)) {
          cliConfig.permissions.allow.push(permission);
          permissionsUpdated = true;
        }
      }

      if (permissionsUpdated || !this.filesystem.exists(cliConfigPath)) {
        await writeFile(cliConfigPath, JSON.stringify(cliConfig, null, 2) + '\n', 'utf-8');
        logger.info('Configured cursor-cli permissions', {
          workspacePath,
          cliConfigPath,
          permissions: cliConfig.permissions.allow,
        });
      } else {
        logger.debug('Cursor-cli permissions already configured', { workspacePath });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to configure workspace trust', {
        workspacePath,
        error: errorMessage,
      });
      // Don't throw - we don't want to fail the entire operation
      // if workspace trust configuration fails
    }
  }
}
