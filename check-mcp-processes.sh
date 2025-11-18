#!/bin/bash
# Check if MCP server processes are running during cursor-cli execution

echo "=== Checking for MCP Server Processes ==="
echo ""

# Check for any node processes running the MCP server
echo "1. Checking for cursor-agents MCP server processes..."
ps aux | grep -E "(mcp-server-wrapper|cursor-agents.*dist/mcp|mcp/index.js)" | grep -v grep || echo "   No MCP server processes found"
echo ""

# Check for any sh processes that might be the wrapper
echo "2. Checking for wrapper script processes..."
ps aux | grep -E "mcp-server-wrapper" | grep -v grep || echo "   No wrapper processes found"
echo ""

# Check MCP config
echo "3. Verifying MCP configuration..."
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "   ✓ MCP config found at /root/.cursor/mcp.json"
  echo ""
  echo "   cursor-agents configuration:"
  cat /root/.cursor/mcp.json | grep -A 8 "cursor-agents" || echo "   (not found)"
else
  echo "   ✗ MCP config not found"
fi
echo ""

# Check if wrapper script exists and is executable
echo "4. Checking wrapper script..."
if [ -f "/app/mcp-server-wrapper.sh" ]; then
  echo "   ✓ Wrapper script exists"
  echo "   Permissions: $(ls -l /app/mcp-server-wrapper.sh | awk '{print $1}')"
  echo "   First few lines:"
  head -5 /app/mcp-server-wrapper.sh
else
  echo "   ✗ Wrapper script not found"
fi
echo ""

echo "=== Diagnostic Complete ==="
echo ""
echo "If no MCP processes are found, cursor-cli may not be spawning them."
echo "If processes are found, they may be hanging during initialization."




