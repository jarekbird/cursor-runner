#!/bin/bash
# Debug why cursor-cli isn't spawning MCP servers

set -e

echo "=== Debugging MCP Server Spawn Issues ==="
echo ""

# 1. Check if cursor-cli can read the config
echo "1. Checking if cursor-cli can access MCP config..."
MCP_CONFIG="/root/.cursor/mcp.json"
if [ -f "$MCP_CONFIG" ]; then
  echo "   ✓ Config file exists and is readable"
  echo "   File permissions: $(ls -l "$MCP_CONFIG" | awk '{print $1, $3, $4}')"
else
  echo "   ✗ Config file not found"
  exit 1
fi
echo ""

# 2. Check if node is available
echo "2. Checking if 'node' command is available..."
if command -v node >/dev/null 2>&1; then
  NODE_PATH=$(which node)
  echo "   ✓ node found at: $NODE_PATH"
  echo "   Version: $(node --version)"
else
  echo "   ✗ node not found in PATH"
  echo "   PATH: $PATH"
  exit 1
fi
echo ""

# 3. Check if MCP server file exists and is readable
echo "3. Checking MCP server file..."
MCP_SERVER="/app/target/cursor-agents/dist/mcp/index.js"
if [ -f "$MCP_SERVER" ]; then
  echo "   ✓ File exists"
  echo "   Permissions: $(ls -l "$MCP_SERVER" | awk '{print $1, $3, $4}')"
  echo "   Size: $(stat -c%s "$MCP_SERVER" 2>/dev/null || stat -f%z "$MCP_SERVER" 2>/dev/null) bytes"
  
  # Check if node can execute it
  if node --check "$MCP_SERVER" 2>/dev/null; then
    echo "   ✓ File is valid JavaScript"
  else
    echo "   ✗ File has syntax errors"
    node --check "$MCP_SERVER" 2>&1 || true
  fi
else
  echo "   ✗ File not found"
  exit 1
fi
echo ""

# 4. Check environment variables
echo "4. Checking environment variables..."
REDIS_URL=$(grep -o '"REDIS_URL"[[:space:]]*:[[:space:]]*"[^"]*"' "$MCP_CONFIG" 2>/dev/null | sed 's/.*"REDIS_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
if [ -n "$REDIS_URL" ]; then
  echo "   ✓ REDIS_URL found in config: $REDIS_URL"
else
  echo "   ⚠ REDIS_URL not found in config"
fi
echo ""

# 5. Test if we can manually spawn the process
echo "5. Testing manual spawn (simulating cursor-cli)..."
export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="production"

echo "   Spawning: node $MCP_SERVER"
timeout 2 node "$MCP_SERVER" </dev/null >/tmp/mcp-manual-stdout.log 2>/tmp/mcp-manual-stderr.log &
MANUAL_PID=$!

sleep 0.5

if ps -p $MANUAL_PID > /dev/null 2>&1; then
  echo "   ✓ Process started (PID: $MANUAL_PID)"
  echo "   STDERR output:"
  head -20 /tmp/mcp-manual-stderr.log 2>/dev/null || echo "   (empty)"
  kill $MANUAL_PID 2>/dev/null || true
  wait $MANUAL_PID 2>/dev/null || true
else
  echo "   ✗ Process exited immediately"
  echo "   STDERR output:"
  cat /tmp/mcp-manual-stderr.log 2>/dev/null || echo "   (empty)"
  echo "   Exit code: $?"
fi
echo ""

# 6. Check if cursor-cli is actually running
echo "6. Checking for cursor-cli processes..."
CURSOR_PIDS=$(ps aux | grep -E '[c]ursor' | awk '{print $2}' || echo "")
if [ -n "$CURSOR_PIDS" ]; then
  echo "   Found cursor processes: $CURSOR_PIDS"
  for pid in $CURSOR_PIDS; do
    echo "   PID $pid: $(ps -p $pid -o cmd= 2>/dev/null || echo 'not found')"
  done
else
  echo "   ⚠ No cursor processes found (might be normal if not currently running)"
fi
echo ""

# 7. Check MCP config format
echo "7. Validating MCP config JSON format..."
if python3 -m json.tool "$MCP_CONFIG" >/dev/null 2>&1; then
  echo "   ✓ Config is valid JSON"
else
  echo "   ✗ Config has JSON syntax errors"
  python3 -m json.tool "$MCP_CONFIG" 2>&1 || true
fi
echo ""

echo "=== Debug Complete ==="
echo ""
echo "If manual spawn works but cursor-cli doesn't spawn:"
echo "  - cursor-cli might not be reading the config"
echo "  - cursor-cli might have different PATH/env when spawning"
echo "  - cursor-cli might need to be restarted"


