#!/bin/bash
# Debug script to monitor MCP server processes during cursor-cli execution

set -e

echo "=== Debugging MCP Timeout Issue ==="
echo ""

# Check if MCP server processes are running
echo "1. Checking for running MCP server processes..."
ps aux | grep -E "(mcp/index.js|cursor-agents.*dist/mcp)" | grep -v grep || echo "   No MCP server processes found"
echo ""

# Check MCP config
echo "2. Checking MCP configuration..."
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "   ✓ MCP config found"
  echo ""
  echo "   cursor-agents configuration:"
  cat /root/.cursor/mcp.json | grep -A 10 "cursor-agents" || echo "   (not found)"
else
  echo "   ✗ MCP config not found"
fi
echo ""

# Test if the shell wrapper works with env vars
echo "3. Testing shell wrapper with environment variables..."
export REDIS_URL="redis://redis:6379/0"
export NODE_ENV="production"

echo "   Testing: sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js'"
echo "   REDIS_URL=$REDIS_URL"
echo "   NODE_ENV=$NODE_ENV"
echo ""

# Try to start and immediately check if process exists
timeout 2 sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js' </dev/null >/tmp/mcp-test-stdout.log 2>/tmp/mcp-test-stderr.log &
MCP_PID=$!

sleep 0.5

if ps -p $MCP_PID > /dev/null 2>&1; then
  echo "   ✓ MCP server process started (PID: $MCP_PID)"
  echo "   stderr output:"
  head -5 /tmp/mcp-test-stderr.log || echo "   (no stderr output)"
  kill $MCP_PID 2>/dev/null || true
else
  echo "   ✗ MCP server process did not start or exited immediately"
  echo "   stderr output:"
  cat /tmp/mcp-test-stderr.log || echo "   (no stderr output)"
fi
echo ""

# Check if cursor-cli can see the MCP config
echo "4. Checking cursor-cli MCP config location..."
if command -v cursor >/dev/null 2>&1; then
  echo "   ✓ cursor-cli is available"
  CURSOR_PATH=$(which cursor)
  echo "   Path: $CURSOR_PATH"
  
  # Check if cursor-cli would read from /root/.cursor/mcp.json
  if [ -f "/root/.cursor/mcp.json" ]; then
    echo "   ✓ MCP config exists at /root/.cursor/mcp.json"
  else
    echo "   ✗ MCP config not found at /root/.cursor/mcp.json"
  fi
else
  echo "   ✗ cursor-cli not found in PATH"
fi
echo ""

echo "=== Diagnostic Complete ==="
echo ""
echo "If MCP server starts but cursor-cli times out:"
echo "  1. cursor-cli might not be spawning the MCP server"
echo "  2. cursor-cli might not be sending initialize request"
echo "  3. There might be a communication issue with stdio"
echo ""
echo "Next steps:"
echo "  - Check cursor-cli logs for MCP connection errors"
echo "  - Verify cursor-cli is reading /root/.cursor/mcp.json"
echo "  - Test MCP protocol handshake manually"







