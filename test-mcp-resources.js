#!/usr/bin/env node
/**
 * Test MCP server to verify resources are properly advertised and accessible
 */

import { spawn } from 'child_process';

const MCP_SERVER_CMD = '/app/mcp-server-wrapper.sh';
const MCP_SERVER_ARGS = [];
const MCP_ENV = {
  ...process.env,
  REDIS_URL: process.env.REDIS_URL || 'redis://redis:6379/0',
  NODE_ENV: 'production',
};

console.log('=== Testing MCP Resources ===\n');
console.log(`Command: ${MCP_SERVER_CMD} ${MCP_SERVER_ARGS.join(' ')}`);
console.log(`REDIS_URL: ${MCP_ENV.REDIS_URL}\n`);

// Spawn the MCP server
const mcpServer = spawn(MCP_SERVER_CMD, MCP_SERVER_ARGS, {
  env: MCP_ENV,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let initializeResponse = null;
let resourcesResponse = null;

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
  
  // Try to parse as JSON (MCP uses JSON-RPC)
  try {
    const lines = text.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        
        if (message.id === 1 && message.result) {
          // Initialize response
          initializeResponse = message;
          console.log('\n✓ Received initialize response:');
          console.log(JSON.stringify(message.result, null, 2));
          
          // Check if resources capability is advertised
          if (message.result.capabilities?.resources) {
            console.log('\n✓ Resources capability is advertised!');
          } else {
            console.log('\n✗ Resources capability is NOT advertised');
            console.log('Capabilities:', JSON.stringify(message.result.capabilities, null, 2));
          }
          
          // Now request resources list
          console.log('\nSending resources/list request...');
          const listResourcesRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'resources/list',
          };
          mcpServer.stdin.write(JSON.stringify(listResourcesRequest) + '\n');
        }
        
        if (message.id === 2 && message.result) {
          // Resources list response
          resourcesResponse = message;
          console.log('\n✓ Received resources/list response:');
          console.log(JSON.stringify(message.result, null, 2));
          
          if (message.result.resources && message.result.resources.length > 0) {
            console.log(`\n✓ Found ${message.result.resources.length} resource(s):`);
            message.result.resources.forEach((r) => {
              console.log(`  - ${r.uri} (${r.name})`);
            });
          } else {
            console.log('\n✓ Resources list is empty (no agents created yet)');
          }
          
          // Test complete
          setTimeout(() => {
            console.log('\n=== Test Complete ===');
            mcpServer.kill('SIGTERM');
            process.exit(0);
          }, 500);
        }
      } catch (e) {
        // Not JSON, that's okay
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

console.log('Sending initialize request...');
console.log(JSON.stringify(initializeRequest, null, 2));
mcpServer.stdin.write(JSON.stringify(initializeRequest) + '\n');

// Timeout after 10 seconds
setTimeout(() => {
  if (!initializeResponse) {
    console.log('\n✗ No initialize response received');
    console.log(`stdout: ${stdout.substring(0, 1000)}`);
    console.log(`stderr: ${stderr.substring(0, 1000)}`);
    mcpServer.kill('SIGTERM');
    process.exit(1);
  } else if (!resourcesResponse) {
    console.log('\n✗ No resources/list response received');
    console.log(`stdout: ${stdout.substring(0, 1000)}`);
    mcpServer.kill('SIGTERM');
    process.exit(1);
  }
}, 10000);

// Handle errors
mcpServer.on('error', (error) => {
  console.error(`\n✗ Failed to spawn MCP server: ${error.message}`);
  process.exit(1);
});

mcpServer.on('exit', (code, signal) => {
  if (code !== 0 && code !== null && code !== 143) {
    console.error(`\n✗ MCP server exited with code ${code} (signal: ${signal})`);
    console.log(`stderr: ${stderr}`);
    process.exit(1);
  }
});




