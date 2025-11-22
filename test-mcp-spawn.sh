#!/bin/bash
# Test script to simulate what cursor-cli does when spawning MCP servers

set -e

echo "=== Testing MCP Server Spawn (simulating cursor-cli) ==="
echo ""

# Read MCP config
MCP_CONFIG="/root/.cursor/mcp.json"
if [ ! -f "$MCP_CONFIG" ]; then
  echo "✗ MCP config not found at $MCP_CONFIG"
  exit 1
fi

echo "✓ MCP config found"
echo ""

# Extract cursor-agents config
echo "Testing cursor-agents MCP server spawn..."
echo ""

# Get the command and args from mcp.json (simple extraction)
COMMAND=$(grep -A 10 '"cursor-agents"' "$MCP_CONFIG" | grep '"command"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
ARGS=$(grep -A 10 '"cursor-agents"' "$MCP_CONFIG" | grep -A 5 '"args"' | grep -v '"args"' | grep '"/app' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
REDIS_URL=$(grep -A 10 '"cursor-agents"' "$MCP_CONFIG" | grep '"REDIS_URL"' | sed 's/.*"REDIS_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

echo "Command: $COMMAND"
echo "Args: $ARGS"
echo "REDIS_URL: $REDIS_URL"
echo ""

# Test if we can execute the command
if ! command -v "$COMMAND" >/dev/null 2>&1; then
  echo "✗ Command '$COMMAND' not found in PATH"
  echo "  PATH: $PATH"
  exit 1
fi

echo "✓ Command '$COMMAND' found in PATH"
echo ""

# Test if the file exists
if [ ! -f "$ARGS" ]; then
  echo "✗ MCP server file not found: $ARGS"
  exit 1
fi

echo "✓ MCP server file exists: $ARGS"
echo ""

# Try to spawn the process like cursor-cli would
echo "Spawning MCP server process (will timeout after 3s)..."
echo ""

export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="production"

# Spawn with stdio like cursor-cli would
timeout 3 "$COMMAND" "$ARGS" </dev/null >/tmp/mcp-test-stdout.log 2>/tmp/mcp-test-stderr.log &
MCP_PID=$!

echo "MCP server PID: $MCP_PID"
echo ""

# Wait a moment, then check if it's still running
sleep 1

if ps -p $MCP_PID > /dev/null 2>&1; then
  echo "✓ MCP server process is running (PID: $MCP_PID)"
  echo ""
  echo "Checking output..."
  echo ""
  echo "STDOUT:"
  cat /tmp/mcp-test-stdout.log 2>/dev/null || echo "(empty)"
  echo ""
  echo "STDERR:"
  cat /tmp/mcp-test-stderr.log 2>/dev/null || echo "(empty)"
  echo ""
  
  # Kill it
  kill $MCP_PID 2>/dev/null || true
  wait $MCP_PID 2>/dev/null || true
else
  echo "✗ MCP server process exited immediately"
  echo ""
  echo "STDOUT:"
  cat /tmp/mcp-test-stdout.log 2>/dev/null || echo "(empty)"
  echo ""
  echo "STDERR:"
  cat /tmp/mcp-test-stderr.log 2>/dev/null || echo "(empty)"
  echo ""
  exit 1
fi

echo "=== Test Complete ==="







