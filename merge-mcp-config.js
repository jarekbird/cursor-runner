#!/usr/bin/env node

/**
 * Script to merge cursor-runner mcp.json with existing mcp.json in repositories directory
 * This ensures both configurations are preserved
 */

const fs = require('fs');
const path = require('path');

// Get the directory where this script is located
const SCRIPT_DIR = __dirname;
// Check if running in Docker container (cursor-runner container has /app/repositories mounted)
const IS_DOCKER = fs.existsSync('/app/repositories');

// In the cursor-runner container:
// - Script is at /app/merge-mcp-config.js (copied during build)
// - mcp.json is at /app/mcp.json (copied during build)
// - Repositories volume is mounted at /app/repositories
const CURSOR_RUNNER_MCP = IS_DOCKER ? '/app/mcp.json' : path.join(SCRIPT_DIR, 'mcp.json');
const REPOSITORIES_MCP = IS_DOCKER ? '/app/repositories/mcp.json' : null;
const ROOT_MCP = IS_DOCKER ? null : path.join(path.resolve(SCRIPT_DIR, '..'), 'mcp.json');

console.log('=== Merging MCP Configuration ===');
console.log(`Script directory: ${SCRIPT_DIR}`);
console.log(`Running in Docker: ${IS_DOCKER}`);
console.log(`Cursor-runner MCP: ${CURSOR_RUNNER_MCP}`);
console.log(`Repositories MCP: ${REPOSITORIES_MCP || 'N/A'}`);
console.log('');

// Determine which existing mcp.json to use (repositories directory or root)
let existingMcp = null;
if (IS_DOCKER) {
  // Running in Docker container - use /app/repositories/mcp.json
  if (fs.existsSync(REPOSITORIES_MCP)) {
    existingMcp = REPOSITORIES_MCP;
    console.log(`Found existing MCP config at: ${REPOSITORIES_MCP}`);
  } else {
    console.log('No existing MCP config found. Creating new one from cursor-runner config.');
    // Create repositories directory if it doesn't exist (should already exist from volume mount)
    const reposDir = path.dirname(REPOSITORIES_MCP);
    if (!fs.existsSync(reposDir)) {
      fs.mkdirSync(reposDir, { recursive: true });
    }
    // Copy cursor-runner config as base
    fs.copyFileSync(CURSOR_RUNNER_MCP, REPOSITORIES_MCP);
    console.log(`Created new MCP config at: ${REPOSITORIES_MCP}`);
    process.exit(0);
  }
} else {
  // Running on host - try to find existing config
  const { execSync } = require('child_process');
  let hostRepositoriesMcp = null;
  
  try {
    // Try to get the Docker volume mount point
    const volumeInfo = execSync('docker volume inspect cursor_runner_repositories --format "{{.Mountpoint}}"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (volumeInfo && volumeInfo.length > 0) {
      hostRepositoriesMcp = path.join(volumeInfo, 'mcp.json');
    }
  } catch (error) {
    // Volume doesn't exist or docker not available
  }
  
  if (hostRepositoriesMcp && fs.existsSync(hostRepositoriesMcp)) {
    existingMcp = hostRepositoriesMcp;
    console.log(`Found existing MCP config at: ${hostRepositoriesMcp}`);
  } else if (ROOT_MCP && fs.existsSync(ROOT_MCP)) {
    existingMcp = ROOT_MCP;
    console.log(`Found existing MCP config at: ${ROOT_MCP}`);
  } else {
    console.log('No existing MCP config found. Creating new one from cursor-runner config.');
    // Use repositories path
    const reposMcp = hostRepositoriesMcp || path.join(path.resolve(SCRIPT_DIR, '..'), 'repositories', 'mcp.json');
    const reposDir = path.dirname(reposMcp);
    if (!fs.existsSync(reposDir)) {
      fs.mkdirSync(reposDir, { recursive: true });
    }
    fs.copyFileSync(CURSOR_RUNNER_MCP, reposMcp);
    console.log(`Created new MCP config at: ${reposMcp}`);
    process.exit(0);
  }
}

// Check if cursor-runner mcp.json exists
if (!fs.existsSync(CURSOR_RUNNER_MCP)) {
  console.error(`Error: cursor-runner MCP config not found at ${CURSOR_RUNNER_MCP}`);
  process.exit(1);
}

// Create backup of existing config
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupFile = `${existingMcp}.backup.${timestamp}`;
fs.copyFileSync(existingMcp, backupFile);
console.log(`Created backup: ${backupFile}`);

// Read existing config
let existing;
try {
  const existingContent = fs.readFileSync(existingMcp, 'utf8');
  existing = JSON.parse(existingContent);
} catch (error) {
  console.error(`Error reading existing MCP config: ${error.message}`);
  process.exit(1);
}

// Read cursor-runner config
let cursorRunner;
try {
  const cursorRunnerContent = fs.readFileSync(CURSOR_RUNNER_MCP, 'utf8');
  cursorRunner = JSON.parse(cursorRunnerContent);
} catch (error) {
  console.error(`Error reading cursor-runner MCP config: ${error.message}`);
  process.exit(1);
}

// Merge mcpServers
if (!existing.mcpServers) {
  existing.mcpServers = {};
}

if (cursorRunner.mcpServers) {
  // Merge servers, cursor-runner config takes precedence for conflicts
  existing.mcpServers = {
    ...existing.mcpServers,
    ...cursorRunner.mcpServers,
  };
}

// Write merged config
try {
  fs.writeFileSync(existingMcp, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  console.log('✓ Successfully merged MCP configurations using Node.js');
} catch (error) {
  console.error(`Error writing merged MCP config: ${error.message}`);
  process.exit(1);
}

console.log('');
console.log('=== Merge Summary ===');
console.log(`Merged cursor-runner MCP config into: ${existingMcp}`);
console.log(`Backup saved to: ${backupFile}`);
console.log('');
console.log('Merged configuration:');
console.log(JSON.stringify(existing, null, 2));

