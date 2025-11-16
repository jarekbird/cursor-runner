#!/usr/bin/env node

/**
 * Script to merge cursor-runner mcp.json with existing mcp.json in repositories directory
 * This ensures both configurations are preserved
 */

const fs = require('fs');
const path = require('path');

// Get the directory where this script is located
const SCRIPT_DIR = __dirname;
// Get the parent directory (VirtualAssistant root)
const PARENT_DIR = path.resolve(SCRIPT_DIR, '..');

const CURSOR_RUNNER_MCP = path.join(SCRIPT_DIR, 'mcp.json');
const ROOT_MCP = path.join(PARENT_DIR, 'mcp.json');

// Try to get Docker volume mount point for cursor_runner_repositories
// If volume doesn't exist or docker isn't available, fall back to local path
let REPOSITORIES_MCP = null;
const { execSync } = require('child_process');

try {
  // Try to get the volume mount point
  const volumeInfo = execSync('docker volume inspect cursor_runner_repositories --format "{{.Mountpoint}}"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  if (volumeInfo && volumeInfo.length > 0) {
    REPOSITORIES_MCP = path.join(volumeInfo, 'mcp.json');
    console.log(`Found Docker volume mount point: ${volumeInfo}`);
  }
} catch (error) {
  // Volume doesn't exist or docker not available, use local path
  REPOSITORIES_MCP = path.join(PARENT_DIR, 'repositories', 'mcp.json');
}

console.log('=== Merging MCP Configuration ===');
console.log(`Script directory: ${SCRIPT_DIR}`);
console.log(`Parent directory: ${PARENT_DIR}`);
console.log('');

// Determine which existing mcp.json to use (repositories directory or root)
let existingMcp = null;
if (REPOSITORIES_MCP && fs.existsSync(REPOSITORIES_MCP)) {
  existingMcp = REPOSITORIES_MCP;
  console.log(`Found existing MCP config at: ${REPOSITORIES_MCP}`);
} else if (fs.existsSync(ROOT_MCP)) {
  existingMcp = ROOT_MCP;
  console.log(`Found existing MCP config at: ${ROOT_MCP}`);
} else {
  console.log('No existing MCP config found. Creating new one from cursor-runner config.');
  // Use repositories path (either Docker volume or local)
  if (!REPOSITORIES_MCP) {
    REPOSITORIES_MCP = path.join(PARENT_DIR, 'repositories', 'mcp.json');
  }
  // Create repositories directory if it doesn't exist
  const reposDir = path.dirname(REPOSITORIES_MCP);
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true });
  }
  // Copy cursor-runner config as base
  fs.copyFileSync(CURSOR_RUNNER_MCP, REPOSITORIES_MCP);
  console.log(`Created new MCP config at: ${REPOSITORIES_MCP}`);
  process.exit(0);
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

