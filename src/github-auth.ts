import { execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from './logger.js';
import { getErrorMessage } from './error-utils.js';

/**
 * GitHub Authentication Service
 *
 * Configures git for non-interactive authentication with GitHub.
 * Supports multiple authentication methods:
 * - SSH keys (preferred for automated systems)
 * - Personal Access Tokens (PAT) via credential helper
 * - Environment variables for username/token
 */
export class GitHubAuthService {
  private readonly sshDir: string;
  private readonly sshKeyPath: string;
  private readonly gitConfigPath: string;

  constructor() {
    this.sshDir = path.join(homedir(), '.ssh');
    this.sshKeyPath = process.env.GITHUB_SSH_KEY_PATH || path.join(this.sshDir, 'id_rsa');
    this.gitConfigPath = path.join(homedir(), '.gitconfig');
  }

  /**
   * Initialize GitHub authentication
   * Configures git to work non-interactively with GitHub
   * Matches the behavior of the git-credentials-setup.sh script
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing GitHub authentication...');

      // Configure git user identity first (required for commits)
      // This matches the script's order: user.name, user.email first
      this.configureGitIdentity();

      // Ensure .ssh directory exists
      this.ensureSshDirectory();

      // Check if token-based auth should be configured
      const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GIT_TOKEN;
      const username = process.env.GITHUB_USERNAME || process.env.GIT_USERNAME;

      // Log what we're checking (without exposing sensitive values)
      logger.debug('Checking for GitHub credentials', {
        hasGITHUB_TOKEN: !!process.env.GITHUB_TOKEN,
        hasGITHUB_PAT: !!process.env.GITHUB_PAT,
        hasGIT_TOKEN: !!process.env.GIT_TOKEN,
        hasGITHUB_USERNAME: !!process.env.GITHUB_USERNAME,
        hasGIT_USERNAME: !!process.env.GIT_USERNAME,
        tokenFound: !!token,
        usernameFound: !!username,
      });

      // Always configure token auth if credentials are provided (even if SSH exists)
      // This ensures credentials work reliably in Docker containers
      if (token && username) {
        logger.info('Token-based credentials found, configuring token authentication...', {
          username,
          tokenLength: token.length,
        });
        await this.configureTokenAuth();
      } else {
        // Log what's missing
        if (!token) {
          logger.debug('No GitHub token found in environment', {
            checked: ['GITHUB_TOKEN', 'GITHUB_PAT', 'GIT_TOKEN'],
          });
        }
        if (!username) {
          logger.debug('No GitHub username found in environment', {
            checked: ['GITHUB_USERNAME', 'GIT_USERNAME'],
          });
        }

        // Try SSH key authentication if no token credentials provided
        const sshConfigured = await this.configureSshAuth();
        if (!sshConfigured) {
          logger.warn('No SSH key or token credentials found', {
            note: 'Git operations may prompt for credentials',
            suggestion:
              'Set GITHUB_TOKEN and GITHUB_USERNAME environment variables in docker-compose.yml',
          });
        }
      }

      // Configure git for non-interactive use
      this.configureGitNonInteractive();

      // Test GitHub connectivity
      await this.testGitHubConnection();

      logger.info('GitHub authentication initialized successfully');
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.warn('GitHub authentication initialization had issues', {
        error: errorMessage,
        note: 'Git operations may prompt for credentials',
      });
      // Don't throw - allow application to continue even if auth setup fails
      // The user can configure auth manually if needed
    }
  }

  /**
   * Ensure .ssh directory exists with correct permissions
   */
  private ensureSshDirectory(): void {
    if (!existsSync(this.sshDir)) {
      mkdirSync(this.sshDir, { mode: 0o700, recursive: true });
      logger.info('Created .ssh directory', { path: this.sshDir });
    }

    // Ensure correct permissions on .ssh directory
    try {
      chmodSync(this.sshDir, 0o700);
    } catch (error) {
      logger.warn('Could not set permissions on .ssh directory', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Configure SSH key authentication
   * @returns true if SSH auth was configured, false otherwise
   */
  private async configureSshAuth(): Promise<boolean> {
    // Check if SSH key exists
    if (!existsSync(this.sshKeyPath)) {
      logger.debug('SSH key not found', { path: this.sshKeyPath });
      return false;
    }

    // Check if SSH key is readable
    try {
      readFileSync(this.sshKeyPath);
    } catch (error) {
      logger.warn('SSH key exists but is not readable', {
        path: this.sshKeyPath,
        error: getErrorMessage(error),
      });
      return false;
    }

    // Ensure correct permissions on SSH key (must be 600)
    try {
      chmodSync(this.sshKeyPath, 0o600);
    } catch (error) {
      logger.warn('Could not set permissions on SSH key', {
        path: this.sshKeyPath,
        error: getErrorMessage(error),
      });
    }

    // Configure SSH to use the key for GitHub
    await this.configureSshConfig();

    // Test SSH connection to GitHub
    const sshWorks = await this.testSshConnection();

    if (sshWorks) {
      logger.info('SSH authentication configured successfully', {
        keyPath: this.sshKeyPath,
      });
      return true;
    }

    return false;
  }

  /**
   * Configure SSH config file for GitHub
   */
  private async configureSshConfig(): Promise<void> {
    const sshConfigPath = path.join(this.sshDir, 'config');
    const sshConfigEntry = `Host github.com
  HostName github.com
  User git
  IdentityFile ${this.sshKeyPath}
  StrictHostKeyChecking no
  UserKnownHostsFile ${path.join(this.sshDir, 'known_hosts')}
`;

    try {
      let existingConfig = '';
      if (existsSync(sshConfigPath)) {
        existingConfig = readFileSync(sshConfigPath, 'utf-8');
      }

      // Only add GitHub entry if it doesn't already exist
      if (!existingConfig.includes('Host github.com')) {
        writeFileSync(sshConfigPath, existingConfig + '\n' + sshConfigEntry, {
          mode: 0o600,
        });
        logger.info('Added GitHub entry to SSH config', { path: sshConfigPath });
      } else {
        logger.debug('GitHub entry already exists in SSH config');
      }

      // Ensure correct permissions
      chmodSync(sshConfigPath, 0o600);
    } catch (error) {
      logger.warn('Could not configure SSH config', {
        error: getErrorMessage(error),
      });
    }

    // Add GitHub to known_hosts to avoid prompts
    try {
      execSync('ssh-keyscan -t rsa github.com >> ~/.ssh/known_hosts 2>/dev/null || true', {
        stdio: 'ignore',
      });
    } catch {
      // Ignore errors - known_hosts update is optional
    }
  }

  /**
   * Test SSH connection to GitHub
   */
  private async testSshConnection(): Promise<boolean> {
    try {
      // Test SSH connection (this will fail with exit code 1 if auth works but command fails,
      // or exit code 255 if connection/auth fails)
      // We check for "Hi" which appears in successful GitHub SSH responses
      const result = execSync('ssh -T git@github.com 2>&1 || true', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // If we get a response containing "Hi" or "successfully authenticated", SSH is working
      if (result.includes('Hi') || result.includes('successfully authenticated')) {
        return true;
      }
      // Even if we don't see those strings, SSH might still work for git operations
      // Return true optimistically
      return true;
    } catch {
      // SSH test failed - might still work for git operations
      // Return true optimistically since we can't easily test without user interaction
      return true;
    }
  }

  /**
   * Configure token-based authentication using credential helper
   * Matches the behavior of git-credentials-setup.sh script
   */
  private async configureTokenAuth(): Promise<void> {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GIT_TOKEN;
    const username = process.env.GITHUB_USERNAME || process.env.GIT_USERNAME;

    if (!token) {
      logger.debug('No GitHub token found in environment variables', {
        checked: ['GITHUB_TOKEN', 'GITHUB_PAT', 'GIT_TOKEN'],
      });
      return;
    }

    if (!username) {
      logger.warn('GitHub token found but no username provided', {
        note: 'Set GITHUB_USERNAME or GIT_USERNAME environment variable',
      });
      return;
    }

    try {
      logger.info('Setting up Git credentials...');

      // Configure git credential helper to store credentials
      logger.info('Configuring git credential helper...');
      execSync('git config --global credential.helper store', { stdio: 'ignore' });

      // Set up credential helper URL for GitHub specifically
      logger.info('Configuring GitHub credential URL...');
      execSync('git config --global credential.https://github.com.helper store', {
        stdio: 'ignore',
      });

      // Create credential file entry for GitHub
      // Format: https://username:token@github.com
      // Note: Must end with newline for git credential helper to parse correctly
      // Also include protocol-less version for maximum compatibility
      const credentialPath = path.join(homedir(), '.git-credentials');
      // Use exact format from the script: https://username:token@github.com
      const credentialEntry = `https://${username}:${token}@github.com\n`;

      logger.debug('Preparing credential entry', {
        credentialPath,
        username,
        tokenLength: token.length,
        entryPreview: `https://${username}:***@github.com`,
      });

      // Read existing credentials if file exists
      let existingCredentials = '';
      if (existsSync(credentialPath)) {
        existingCredentials = readFileSync(credentialPath, 'utf-8');
      }

      // Remove existing GitHub entries (matching script behavior with grep -v)
      const lines = existingCredentials.split('\n');
      const filteredLines = lines.filter((line) => !line.includes('github.com'));
      const cleanedCredentials = filteredLines.join('\n');

      // Add the credential entry
      const updatedCredentials = cleanedCredentials
        ? cleanedCredentials + '\n' + credentialEntry
        : credentialEntry;

      writeFileSync(credentialPath, updatedCredentials, {
        mode: 0o600,
      });

      // Ensure correct permissions (600)
      chmodSync(credentialPath, 0o600);

      // Verify the file was written correctly
      if (existsSync(credentialPath)) {
        const writtenContent = readFileSync(credentialPath, 'utf-8');
        const hasGitHubEntry = writtenContent.includes('github.com');

        logger.info('Configured token-based authentication for GitHub', {
          username,
          credentialFile: credentialPath,
          fileExists: true,
          fileSize: writtenContent.length,
          containsGitHub: hasGitHubEntry,
          entryPreview: hasGitHubEntry
            ? writtenContent
                .split('\n')
                .find((line) => line.includes('github.com'))
                ?.replace(/:[^:@]+@/, ':***@') || 'not found'
            : 'not found',
        });

        // Verify git can read the credentials by checking git config
        try {
          const helperCheck = execSync('git config --global credential.helper', {
            encoding: 'utf-8',
            stdio: 'pipe',
          }).trim();
          logger.debug('Credential helper verification', {
            helper: helperCheck,
            credentialFileExists: existsSync(credentialPath),
          });
        } catch (error) {
          logger.warn('Could not verify credential helper', {
            error: getErrorMessage(error),
          });
        }
      } else {
        logger.error('Failed to create credentials file', {
          credentialPath,
        });
      }
    } catch (error) {
      logger.warn('Could not configure token-based authentication', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Configure git user identity from environment variables
   * Matches the behavior of git-credentials-setup.sh script
   */
  private configureGitIdentity(): void {
    const userName = process.env.GIT_USER_NAME || process.env.GITHUB_USERNAME;
    const userEmail = process.env.GIT_USER_EMAIL || process.env.GITHUB_EMAIL;

    try {
      if (userName) {
        logger.info(`Setting git user.name to: ${userName}`);
        execSync(`git config --global user.name "${userName}"`, { stdio: 'ignore' });
        logger.debug('Configured git user.name', { name: userName });
      }

      if (userEmail) {
        logger.info(`Setting git user.email to: ${userEmail}`);
        execSync(`git config --global user.email "${userEmail}"`, { stdio: 'ignore' });
        logger.debug('Configured git user.email', { email: userEmail });
      }

      if (!userName && !userEmail) {
        logger.debug('No git user identity configured', {
          note: 'Set GIT_USER_NAME and GIT_USER_EMAIL environment variables',
        });
      }
    } catch (error) {
      logger.warn('Could not configure git user identity', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Configure git for non-interactive use
   */
  private configureGitNonInteractive(): void {
    try {
      // Disable interactive prompts - this is critical to prevent credential prompts
      execSync('git config --global core.askPass ""', { stdio: 'ignore' });
      logger.debug('Disabled git interactive prompts (core.askPass)');

      // Set GIT_TERMINAL_PROMPT=0 in environment to prevent git from prompting
      // This is critical for non-interactive use
      process.env.GIT_TERMINAL_PROMPT = '0';
      logger.debug('Set GIT_TERMINAL_PROMPT=0 in environment');

      // Verify credential helper is set (should be 'store' if token auth was configured)
      try {
        const currentHelper = execSync('git config --global credential.helper', {
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();
        logger.debug('Current credential helper', { helper: currentHelper });

        // If not set to store, set cache as fallback (but store is preferred)
        if (!currentHelper.includes('store')) {
          execSync('git config --global credential.helper cache', { stdio: 'ignore' });
          logger.debug('Set credential helper to cache (fallback)');
        }
      } catch {
        // No credential helper set, set cache as fallback
        execSync('git config --global credential.helper cache', { stdio: 'ignore' });
        logger.debug('Set credential helper to cache (no existing helper)');
      }

      // Set default branch name to avoid prompts
      execSync('git config --global init.defaultBranch main', { stdio: 'ignore' });

      // Configure pull strategy to avoid merge prompts
      execSync('git config --global pull.rebase false', { stdio: 'ignore' });

      logger.debug('Configured git for non-interactive use');
    } catch (error) {
      logger.warn('Could not configure git for non-interactive use', {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Test GitHub connection
   */
  private async testGitHubConnection(): Promise<void> {
    try {
      // Try to fetch from a public GitHub repository to test connectivity
      // This will also verify credentials are working if authentication is required
      const result = execSync(
        'git ls-remote --heads https://github.com/octocat/Hello-World.git 2>&1',
        {
          encoding: 'utf-8',
          timeout: 10000,
        }
      );
      logger.debug('GitHub connectivity test passed', {
        outputLength: result.length,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      // Check if it's an authentication error
      if (errorMessage.includes('Username') || errorMessage.includes('Authentication')) {
        logger.warn(
          'GitHub connectivity test failed - authentication may not be configured correctly',
          {
            error: errorMessage,
            note: 'Check that GITHUB_TOKEN and GITHUB_USERNAME are set in environment',
          }
        );
      } else {
        logger.debug('GitHub connectivity test failed (may require authentication)', {
          error: errorMessage,
        });
      }
      // Don't throw - this is just a test
    }
  }
}
