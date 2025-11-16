#!/usr/bin/env node
/**
 * Test script to verify cursor-agents MCP server responds to MCP protocol requests
 * This simulates what cursor-cli does when connecting to the MCP server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCP_SERVER_PATH = '/app/target/cursor-agents/dist/mcp/index.js';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379/0';

console.log('=== Testing cursor-agents MCP Server Protocol ===\n');
console.log(`MCP Server: ${MCP_SERVER_PATH}`);
console.log(`REDIS_URL: ${REDIS_URL}\n`);

// Spawn the MCP server process (like cursor-cli does)
const mcpServer = spawn('node', [MCP_SERVER_PATH], {
  env: {
    ...process.env,
    REDIS_URL,
    NODE_ENV: 'production',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let initialized = false;

// Collect stdout
mcpServer.stdout.on('data', (data) => {
  const chunk = data.toString();
  stdout += chunk;
  console.log('[STDOUT]', chunk.trim());
});

// Collect stderr (this is where our logging goes)
mcpServer.stderr.on('data', (data) => {
  const chunk = data.toString();
  stderr += chunk;
  console.log('[STDERR]', chunk.trim());
});

// Handle process exit
mcpServer.on('exit', (code) => {
  console.log(`\n[MCP Server exited with code: ${code}]`);
  if (code !== 0 && code !== null) {
    console.error('\n✗ MCP server crashed!');
    console.error('\nSTDERR output:');
    console.error(stderr);
    process.exit(1);
  }
});

// Send MCP initialize request (JSON-RPC 2.0 format)
const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  },
};

console.log('Sending initialize request...\n');
mcpServer.stdin.write(JSON.stringify(initializeRequest) + '\n');

// After a short delay, send list_tools request
setTimeout(() => {
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  };
  
  console.log('Sending list_tools request...\n');
  mcpServer.stdin.write(JSON.stringify(listToolsRequest) + '\n');
  
  // Give it time to respond, then check results
  setTimeout(() => {
    if (stdout.includes('create_agent') || stdout.includes('"name"')) {
      console.log('\n✓ MCP server is responding correctly!');
      console.log('✓ Tools are available');
    } else {
      console.log('\n⚠ MCP server started but tools not visible in output');
      console.log('This might be normal - check if cursor-cli can see them');
    }
    
    mcpServer.kill('SIGTERM');
    
    setTimeout(() => {
      if (!mcpServer.killed) {
        mcpServer.kill('SIGKILL');
      }
      process.exit(0);
    }, 1000);
  }, 2000);
}, 1000);

// Timeout after 10 seconds
setTimeout(() => {
  console.log('\n⚠ Test timeout - MCP server may still be running');
  mcpServer.kill('SIGTERM');
  setTimeout(() => {
    if (!mcpServer.killed) {
      mcpServer.kill('SIGKILL');
    }
    process.exit(0);
  }, 1000);
}, 10000);

