#!/bin/bash
# Test spawning the MCP server exactly as cursor-cli would

set -e

echo "=== Testing MCP Server Spawn (as cursor-cli would) ==="
echo ""

MCP_CONFIG="/root/.cursor/mcp.json"
if [ ! -f "$MCP_CONFIG" ]; then
  echo "✗ MCP config not found"
  exit 1
fi

echo "✓ MCP config found"
echo ""

# Extract cursor-agents config using a simple approach
COMMAND="/app/mcp-server-wrapper.sh"
ARGS=""
REDIS_URL="redis://redis:6379/0"
NODE_ENV="production"

echo "Command: $COMMAND"
echo "Args: $ARGS"
echo "REDIS_URL: $REDIS_URL"
echo "NODE_ENV: $NODE_ENV"
echo ""

# Test if command exists and is executable
if [ ! -f "$COMMAND" ]; then
  echo "✗ Command not found: $COMMAND"
  exit 1
fi

if [ ! -x "$COMMAND" ]; then
  echo "✗ Command not executable: $COMMAND"
  exit 1
fi

echo "✓ Command exists and is executable"
echo ""

# Spawn exactly as cursor-cli would (with stdio)
echo "Spawning MCP server (will timeout after 5s)..."
echo ""

export REDIS_URL="$REDIS_URL"
export NODE_ENV="$NODE_ENV"

# Spawn with stdio like cursor-cli does
# Use timeout to prevent hanging
timeout 5 "$COMMAND" $ARGS </dev/null >/tmp/mcp-spawn-stdout.log 2>/tmp/mcp-spawn-stderr.log &
MCP_PID=$!

echo "MCP server PID: $MCP_PID"
echo ""

# Wait a moment
sleep 1

# Check if process is still running
if kill -0 $MCP_PID 2>/dev/null; then
  echo "✓ Process is running (PID: $MCP_PID)"
  echo ""
  echo "STDERR output (first 20 lines):"
  head -20 /tmp/mcp-spawn-stderr.log 2>/dev/null || echo "  (empty)"
  echo ""
  echo "STDOUT output (first 20 lines):"
  head -20 /tmp/spawn-stdout.log 2>/dev/null || echo "  (empty)"
  echo ""
  
  # Kill it
  kill $MCP_PID 2>/dev/null || true
  wait $MCP_PID 2>/dev/null || true
  echo "✓ Process terminated"
else
  echo "✗ Process exited immediately"
  echo ""
  echo "STDERR output:"
  cat /tmp/mcp-spawn-stderr.log 2>/dev/null || echo "  (empty)"
  echo ""
  echo "STDOUT output:"
  cat /tmp/mcp-spawn-stdout.log 2>/dev/null || echo "  (empty)"
  echo ""
  echo "Exit code: $?"
fi

echo ""
echo "=== Test Complete ==="






