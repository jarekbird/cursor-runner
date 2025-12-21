#!/usr/bin/env node

/**
 * Script to merge cursor-runner mcp.json with existing mcp.json in /cursor directory
 * This ensures both configurations are preserved
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Get the directory where this script is located (ES module way)
const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
// Check if running in Docker container (cursor-runner container has /cursor mounted)
const IS_DOCKER = fs.existsSync('/cursor');

// In the cursor-runner container:
// - Script is at /app/merge-mcp-config.js (copied during build)
// - mcp.json is at /app/mcp.json (copied during build)
// - Cursor volume is mounted at /cursor (contains repositories, scripts, tools directories)
const CURSOR_RUNNER_MCP = IS_DOCKER ? '/app/mcp.json' : path.join(SCRIPT_DIR, 'mcp.json');
const CURSOR_MCP = IS_DOCKER ? '/cursor/mcp.json' : null;
const ROOT_MCP = IS_DOCKER ? null : path.join(path.resolve(SCRIPT_DIR, '..'), 'mcp.json');

console.log('=== Merging MCP Configuration ===');
console.log(`Script directory: ${SCRIPT_DIR}`);
console.log(`Running in Docker: ${IS_DOCKER}`);
console.log(`Cursor-runner MCP: ${CURSOR_RUNNER_MCP}`);
console.log(`Cursor MCP: ${CURSOR_MCP || 'N/A'}`);
console.log('');

// Determine which existing mcp.json to use (cursor root directory or root)
let existingMcp = null;
if (IS_DOCKER) {
  // Running in Docker container - use /cursor/mcp.json
  if (fs.existsSync(CURSOR_MCP)) {
    existingMcp = CURSOR_MCP;
    console.log(`Found existing MCP config at: ${CURSOR_MCP}`);
  } else {
    console.log('No existing MCP config found. Creating new one from cursor-runner config.');
    // Create cursor directory if it doesn't exist (should already exist from volume mount)
    const cursorDir = path.dirname(CURSOR_MCP);
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    // Copy cursor-runner config as base
    fs.copyFileSync(CURSOR_RUNNER_MCP, CURSOR_MCP);
    console.log(`Created new MCP config at: ${CURSOR_MCP}`);
    
    // Also copy to /root/.cursor/mcp.json for cursor-cli
    const cursorCliMcp = '/root/.cursor/mcp.json';
    try {
      const cursorCliDir = path.dirname(cursorCliMcp);
      if (!fs.existsSync(cursorCliDir)) {
        fs.mkdirSync(cursorCliDir, { recursive: true });
      }
      fs.copyFileSync(CURSOR_MCP, cursorCliMcp);
      console.log(`✓ Copied config to ${cursorCliMcp} for cursor-cli`);
    } catch (error) {
      console.warn(`Warning: Could not copy config to ${cursorCliMcp}: ${error.message}`);
    }
    
    process.exit(0);
  }
} else {
  // Running on host - try to find existing config
  let hostCursorMcp = null;
  
  try {
    // Try to get the Docker volume mount point
    const volumeInfo = execSync('docker volume inspect cursor_runner_repositories --format "{{.Mountpoint}}"', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (volumeInfo && volumeInfo.length > 0) {
      hostCursorMcp = path.join(volumeInfo, 'mcp.json');
    }
  } catch (error) {
    // Volume doesn't exist or docker not available
  }
  
  if (hostCursorMcp && fs.existsSync(hostCursorMcp)) {
    existingMcp = hostCursorMcp;
    console.log(`Found existing MCP config at: ${hostCursorMcp}`);
  } else if (ROOT_MCP && fs.existsSync(ROOT_MCP)) {
    existingMcp = ROOT_MCP;
    console.log(`Found existing MCP config at: ${ROOT_MCP}`);
  } else {
    console.log('No existing MCP config found. Creating new one from cursor-runner config.');
    // Use cursor root path
    const cursorMcp = hostCursorMcp || path.join(path.resolve(SCRIPT_DIR, '..'), 'mcp.json');
    const cursorDir = path.dirname(cursorMcp);
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    fs.copyFileSync(CURSOR_RUNNER_MCP, cursorMcp);
    console.log(`Created new MCP config at: ${cursorMcp}`);
    process.exit(0);
  }
}

// Check if cursor-runner mcp.json exists
if (!fs.existsSync(CURSOR_RUNNER_MCP)) {
  console.error(`Error: cursor-runner MCP config not found at ${CURSOR_RUNNER_MCP}`);
  process.exit(1);
}

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
  // Check if Gmail MCP is enabled via feature flag
  const enableGmailMcp = process.env.ENABLE_GMAIL_MCP;
  const gmailMcpEnabled =
    enableGmailMcp &&
    (enableGmailMcp.toLowerCase().trim() === 'true' ||
      enableGmailMcp.toLowerCase().trim() === '1' ||
      enableGmailMcp.toLowerCase().trim() === 'yes' ||
      enableGmailMcp.toLowerCase().trim() === 'on');

  // Check if Atlassian MCP is enabled via feature flag
  const enableAtlassianMcp = process.env.ENABLE_ATLASSIAN_MCP;
  const atlassianMcpEnabled =
    enableAtlassianMcp &&
    (enableAtlassianMcp.toLowerCase().trim() === 'true' ||
      enableAtlassianMcp.toLowerCase().trim() === '1' ||
      enableAtlassianMcp.toLowerCase().trim() === 'yes' ||
      enableAtlassianMcp.toLowerCase().trim() === 'on');

  // Merge servers, cursor-runner config takes precedence for conflicts
  const serversToMerge = { ...cursorRunner.mcpServers };

  // Conditionally include Gmail MCP based on feature flag
  if (!gmailMcpEnabled && serversToMerge.gmail) {
    console.log('Gmail MCP is disabled (ENABLE_GMAIL_MCP is not true) - excluding from config');
    delete serversToMerge.gmail;
  } else if (gmailMcpEnabled && serversToMerge.gmail) {
    console.log('Gmail MCP is enabled (ENABLE_GMAIL_MCP=true) - including in config');
  }

  // Conditionally include Atlassian MCP based on feature flag
  if (!atlassianMcpEnabled && serversToMerge.atlassian) {
    console.log('Atlassian MCP is disabled (ENABLE_ATLASSIAN_MCP is not true) - excluding from config');
    delete serversToMerge.atlassian;
  } else if (atlassianMcpEnabled && serversToMerge.atlassian) {
    console.log('Atlassian MCP is enabled (ENABLE_ATLASSIAN_MCP=true) - including in config');
  }

  existing.mcpServers = {
    ...existing.mcpServers,
    ...serversToMerge,
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

// If running in Docker, also copy merged config to /root/.cursor/mcp.json for cursor-cli
if (IS_DOCKER) {
  const cursorCliMcp = '/root/.cursor/mcp.json';
  try {
    // Ensure directory exists
    const cursorCliDir = path.dirname(cursorCliMcp);
    if (!fs.existsSync(cursorCliDir)) {
      fs.mkdirSync(cursorCliDir, { recursive: true });
    }
    // Copy merged config to cursor-cli location
    fs.copyFileSync(existingMcp, cursorCliMcp);
    console.log(`✓ Copied merged config to ${cursorCliMcp} for cursor-cli`);
  } catch (error) {
    console.warn(`Warning: Could not copy merged config to ${cursorCliMcp}: ${error.message}`);
    console.warn('cursor-cli may not see the merged MCP configuration');
  }
}

console.log('');
console.log('=== Merge Summary ===');
console.log(`Merged cursor-runner MCP config into: ${existingMcp}`);
if (IS_DOCKER) {
  console.log(`Also copied to /root/.cursor/mcp.json for cursor-cli`);
}
console.log('');
console.log('Merged configuration:');
console.log(JSON.stringify(existing, null, 2));

