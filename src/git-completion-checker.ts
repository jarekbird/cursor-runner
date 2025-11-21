import { execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * Result of checking if task completion criteria are met
 */
export interface CompletionCheckResult {
  isComplete: boolean;
  reason: string;
  hasPullRequest: boolean;
  hasPushedCommits: boolean;
}

/**
 * GitCompletionChecker - Checks if task completion criteria are met
 *
 * Checks if a Pull Request was created or if code was pushed to origin
 * as indicators of task completion.
 */
export class GitCompletionChecker {
  /**
   * Check if a pull request exists for the current branch
   * @param cwd - Working directory (repository path)
   * @returns true if PR exists, false otherwise
   */
  private checkForPullRequest(cwd: string): boolean {
    try {
      // Get current branch name
      const currentBranch = execSync('git branch --show-current', {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      if (!currentBranch) {
        return false;
      }

      // Check if there's a remote tracking branch
      try {
        const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();

        if (!upstream) {
          return false;
        }

        // Fetch latest remote info
        execSync('git fetch origin', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        // Check if local branch has commits ahead of remote
        // This indicates code was pushed (which is one completion criteria)
        // For PR detection, we check if branch exists on remote and differs from main/master
        const mainBranch = this.getMainBranch(cwd);
        if (mainBranch) {
          try {
            // Check if current branch exists on remote and differs from main
            execSync(`git rev-parse --verify origin/${currentBranch}`, {
              cwd,
              encoding: 'utf-8',
              stdio: 'pipe',
            });

            // If branch exists on remote and is different from main, likely a PR
            const localCommit = execSync('git rev-parse HEAD', {
              cwd,
              encoding: 'utf-8',
              stdio: 'pipe',
            }).trim();

            const mainCommit = execSync(`git rev-parse origin/${mainBranch}`, {
              cwd,
              encoding: 'utf-8',
              stdio: 'pipe',
            }).trim();

            // If branches differ, there might be a PR
            // We can't definitively check if PR exists without GitHub API,
            // but if branch is pushed and differs from main, it's likely a PR candidate
            return localCommit !== mainCommit;
          } catch {
            // Branch doesn't exist on remote
            return false;
          }
        }
      } catch {
        // No upstream branch set
        return false;
      }

      return false;
    } catch (error) {
      logger.warn('Failed to check for pull request', {
        error: error instanceof Error ? error.message : String(error),
        cwd,
      });
      return false;
    }
  }

  /**
   * Check if code was pushed to origin
   * @param cwd - Working directory (repository path)
   * @returns true if code was pushed, false otherwise
   */
  private checkIfPushedToOrigin(cwd: string): boolean {
    try {
      // Get current branch
      const currentBranch = execSync('git branch --show-current', {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();

      if (!currentBranch) {
        return false;
      }

      // Check if upstream is set
      try {
        const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();

        if (!upstream) {
          return false;
        }

        // Fetch latest
        execSync('git fetch origin', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        // Get local and remote commit hashes
        const localCommit = execSync('git rev-parse @', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();

        const remoteCommit = execSync(`git rev-parse ${upstream}`, {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();

        // If local and remote are the same, code was pushed
        return localCommit === remoteCommit && localCommit !== '';
      } catch {
        // No upstream or fetch failed
        return false;
      }
    } catch (error) {
      logger.warn('Failed to check if code was pushed', {
        error: error instanceof Error ? error.message : String(error),
        cwd,
      });
      return false;
    }
  }

  /**
   * Get the main branch name (main or master)
   * @param cwd - Working directory
   * @returns main branch name or null
   */
  private getMainBranch(cwd: string): string | null {
    try {
      // Try main first
      try {
        execSync('git rev-parse --verify origin/main', {
          cwd,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        return 'main';
      } catch {
        // Try master
        try {
          execSync('git rev-parse --verify origin/master', {
            cwd,
            encoding: 'utf-8',
            stdio: 'pipe',
          });
          return 'master';
        } catch {
          return null;
        }
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if task completion criteria are met
   * @param cwd - Working directory (repository path)
   * @param definitionOfDone - Optional custom definition of done from task/files (reserved for future use)
   * @returns Completion check result
   */
  checkCompletion(
    cwd: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    definitionOfDone?: string
  ): CompletionCheckResult {
    // If custom definition of done is provided, we'll need to evaluate it
    // For now, we use the default: PR created OR code pushed to origin
    // Note: _definitionOfDone parameter is reserved for future custom evaluation logic

    // Check for PR
    const hasPullRequest = this.checkForPullRequest(cwd);

    // Check if code was pushed
    const hasPushedCommits = this.checkIfPushedToOrigin(cwd);

    // Task is complete if either condition is met (default definition)
    const isComplete = hasPullRequest || hasPushedCommits;

    let reason: string;
    if (isComplete) {
      if (hasPullRequest && hasPushedCommits) {
        reason = 'Pull Request created and code pushed to origin';
      } else if (hasPullRequest) {
        reason = 'Pull Request created';
      } else {
        reason = 'Code pushed to origin';
      }
    } else {
      reason = 'No Pull Request created and code not pushed to origin';
    }

    return {
      isComplete,
      reason,
      hasPullRequest,
      hasPushedCommits,
    };
  }
}
