#!/usr/bin/env node
/**
 * Test MCP protocol handshake to verify cursor-cli can communicate with the MCP server
 */

import { spawn } from 'child_process';

const MCP_SERVER_CMD = '/app/mcp-server-wrapper.sh';
const MCP_SERVER_ARGS = [];
const MCP_ENV = {
  ...process.env,
  REDIS_URL: process.env.REDIS_URL || 'redis://redis:6379/0',
  NODE_ENV: 'production',
};

console.log('=== Testing MCP Protocol Handshake ===\n');
console.log(`Command: ${MCP_SERVER_CMD} ${MCP_SERVER_ARGS.join(' ')}`);
console.log(`REDIS_URL: ${MCP_ENV.REDIS_URL}\n`);

// Spawn the MCP server
const mcpServer = spawn(MCP_SERVER_CMD, MCP_SERVER_ARGS, {
  env: MCP_ENV,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let initialized = false;

// Collect stderr (for debugging)
mcpServer.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(`[MCP stderr] ${text}`);
});

// Collect stdout (MCP protocol messages)
mcpServer.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  stdout += text;
  console.log(`[MCP stdout] ${text}`);
  
  // Try to parse as JSON (MCP uses JSON-RPC)
  try {
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.method === 'initialize' || message.result) {
        console.log(`\n✓ Received MCP message: ${JSON.stringify(message, null, 2)}`);
        initialized = true;
      }
    }
  } catch (e) {
    // Not JSON, that's okay
  }
});

// Send initialize request (MCP protocol)
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

console.log('\nSending initialize request...');
console.log(JSON.stringify(initializeRequest, null, 2));
mcpServer.stdin.write(JSON.stringify(initializeRequest) + '\n');

// Wait a bit for response
setTimeout(() => {
  if (initialized) {
    console.log('\n✓ MCP handshake successful!');
    console.log('\nSending list_tools request...');
    
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    };
    
    mcpServer.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    
    setTimeout(() => {
      console.log('\n=== Test Complete ===');
      console.log(`stdout length: ${stdout.length}`);
      console.log(`stderr length: ${stderr.length}`);
      mcpServer.kill('SIGTERM');
      process.exit(0);
    }, 2000);
  } else {
    console.log('\n✗ MCP handshake failed - no response received');
    console.log(`stdout: ${stdout.substring(0, 500)}`);
    console.log(`stderr: ${stderr.substring(0, 500)}`);
    mcpServer.kill('SIGTERM');
    process.exit(1);
  }
}, 3000);

// Handle errors
mcpServer.on('error', (error) => {
  console.error(`\n✗ Failed to spawn MCP server: ${error.message}`);
  process.exit(1);
});

mcpServer.on('exit', (code, signal) => {
  if (code !== 0 && code !== null) {
    console.error(`\n✗ MCP server exited with code ${code} (signal: ${signal})`);
    console.log(`stderr: ${stderr}`);
    process.exit(1);
  }
});

