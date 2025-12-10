import path from 'path';

/**
 * Get the TARGET_APP_PATH from environment variables
 * @returns The TARGET_APP_PATH or undefined if not set
 */
export function getTargetAppPath(): string | undefined {
  return process.env.TARGET_APP_PATH;
}

/**
 * Resolve a path relative to TARGET_APP_PATH
 * If an explicit environment variable is set, it takes precedence (for backward compatibility)
 * Otherwise, if TARGET_APP_PATH is set, resolves relative to it
 * If neither is set, returns the default path
 * @param envVarName - Name of the environment variable to check for explicit override
 * @param relativePath - Path relative to TARGET_APP_PATH (e.g., 'scripts', 'repositories', 'tools/cursor-agents')
 * @param defaultPath - Default absolute path to use if TARGET_APP_PATH is not set
 * @returns Resolved absolute path
 */
export function resolvePathRelativeToTargetApp(
  envVarName: string,
  relativePath: string,
  defaultPath: string
): string {
  // Check if explicit environment variable is set (takes precedence)
  const explicitPath = process.env[envVarName];
  if (explicitPath) {
    return explicitPath;
  }

  // Otherwise, resolve relative to TARGET_APP_PATH if it's set
  const targetAppPath = getTargetAppPath();
  if (targetAppPath) {
    return path.join(targetAppPath, relativePath);
  }

  // Fall back to default path
  return defaultPath;
}

/**
 * Get SCRIPTS_PATH relative to TARGET_APP_PATH
 * Explicit SCRIPTS_PATH env var takes precedence, otherwise resolves to TARGET_APP_PATH/scripts
 */
export function getScriptsPath(): string {
  return resolvePathRelativeToTargetApp('SCRIPTS_PATH', 'scripts', '/cursor/scripts');
}

/**
 * Get REPOSITORIES_PATH relative to TARGET_APP_PATH
 * Explicit REPOSITORIES_PATH env var takes precedence, otherwise resolves to TARGET_APP_PATH/repositories
 */
export function getRepositoriesPath(): string {
  return resolvePathRelativeToTargetApp(
    'REPOSITORIES_PATH',
    'repositories',
    path.join(process.cwd(), 'repositories')
  );
}

/**
 * Get CURSOR_AGENTS_TOOLS_PATH relative to TARGET_APP_PATH
 * Explicit CURSOR_AGENTS_TOOLS_PATH env var takes precedence, otherwise resolves to TARGET_APP_PATH/tools/cursor-agents
 */
export function getCursorAgentsToolsPath(): string {
  return resolvePathRelativeToTargetApp(
    'CURSOR_AGENTS_TOOLS_PATH',
    'tools/cursor-agents',
    '/cursor/tools/cursor-agents'
  );
}







