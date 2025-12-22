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

// Function to resolve environment variable placeholders in config
// This function recursively processes the config object and replaces ${VAR_NAME} with actual env var values
function resolveEnvVars(obj, path = '') {
  if (typeof obj === 'string') {
    // Match ${VAR_NAME} pattern
    return obj.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = process.env[varName];
      if (value === undefined || value === '') {
        // In production, if env var is not set, keep the placeholder
        // This allows the MCP server to potentially resolve it at runtime, or fail gracefully
        if (IS_DOCKER) {
          // Only warn in Docker (production) if it's a critical variable
          const criticalVars = ['ATLASSIAN_API_TOKEN', 'ATLASSIAN_EMAIL', 'ATLASSIAN_CLOUD_ID'];
          if (criticalVars.includes(varName)) {
            console.warn(`Warning: Environment variable ${varName} is not set${path ? ` at ${path}` : ''}`);
            console.warn(`  The MCP server may not be able to authenticate properly`);
            console.warn(`  Ensure ${varName} is set in your docker-compose.yml or .env file`);
          }
        }
        return match; // Keep original placeholder if env var not set
      }
      return value;
    });
  } else if (Array.isArray(obj)) {
    return obj.map((item, index) => resolveEnvVars(item, `${path}[${index}]`));
  } else if (obj !== null && typeof obj === 'object') {
    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      resolved[key] = resolveEnvVars(value, newPath);
    }
    return resolved;
  }
  return obj;
}

// Redact secrets from configs before logging to stdout/stderr.
// This avoids leaking credentials into container logs while still allowing us to
// inspect the shape of the merged MCP config.
function redactForLogging(obj) {
  const SENSITIVE_KEY_RE = /(token|secret|password|api[_-]?key|refresh[_-]?token)/i;

  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean' || obj == null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((v) => redactForLogging(v));
  }
  if (typeof obj === 'object') {
    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        // Keep a tiny bit of signal (length) but never print the value
        const len = typeof value === 'string' ? value.length : undefined;
        redacted[key] = typeof len === 'number' ? `<redacted:${len}>` : '<redacted>';
      } else {
        redacted[key] = redactForLogging(value);
      }
    }
    return redacted;
  }
  return obj;
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

// Check feature flags outside the if block so they're available for verification later
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

if (cursorRunner.mcpServers) {

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

  // Also remove disabled MCPs from existing config (in case they were already there)
  if (!gmailMcpEnabled && existing.mcpServers.gmail) {
    delete existing.mcpServers.gmail;
  }
  if (!atlassianMcpEnabled && existing.mcpServers.atlassian) {
    delete existing.mcpServers.atlassian;
  }
}

// Resolve environment variable placeholders in the merged config
// This step is critical for production where env vars must be resolved from the container environment
console.log('Resolving environment variable placeholders...');
const envVarCount = Object.keys(process.env).length;
console.log(`  Environment variables available: ${envVarCount}`);
if (IS_DOCKER) {
  // In Docker/production, verify critical env vars are available
  const requiredVars = ['ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN', 'ATLASSIAN_CLOUD_ID'];
  const missingVars = requiredVars.filter(v => !process.env[v] || process.env[v] === '');
  if (missingVars.length > 0 && atlassianMcpEnabled) {
    console.warn(`  ⚠ Warning: Some Atlassian MCP environment variables are not set: ${missingVars.join(', ')}`);
    console.warn(`  The MCP server may fail to authenticate. Check your docker-compose.yml or .env file.`);
  }
}
existing = resolveEnvVars(existing);

// Verify critical environment variables were resolved (only in Docker/production)
if (IS_DOCKER && atlassianMcpEnabled && existing.mcpServers?.atlassian) {
  const atlassianConfig = existing.mcpServers.atlassian;
  const env = atlassianConfig.env || {};
  const hasPlaceholders = Object.values(env).some(value => 
    typeof value === 'string' && value.includes('${')
  );
  
  if (hasPlaceholders) {
    console.warn('  ⚠ Warning: Some Atlassian MCP environment variables were not resolved');
    console.warn('  The MCP config still contains placeholders, which may cause authentication failures');
    console.warn('  Verify that ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, and ATLASSIAN_CLOUD_ID are set');
    console.warn('  in your docker-compose.yml environment section or .env file');
  } else {
    console.log('  ✓ All Atlassian MCP environment variables resolved successfully');
  }
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
console.log(JSON.stringify(redactForLogging(existing), null, 2));

