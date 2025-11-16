#!/bin/bash
# Comprehensive MCP diagnostic script

set -e

echo "=========================================="
echo "MCP Connection Diagnostic"
echo "=========================================="
echo ""

# 1. Check MCP config exists
echo "1. Checking MCP configuration..."
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "   ✓ MCP config found at /root/.cursor/mcp.json"
  echo ""
  echo "   Config contents:"
  cat /root/.cursor/mcp.json | python3 -m json.tool 2>/dev/null || cat /root/.cursor/mcp.json
  echo ""
else
  echo "   ✗ MCP config NOT found at /root/.cursor/mcp.json"
  echo "   → Run: node /app/merge-mcp-config.js"
  exit 1
fi

# 2. Check cursor-agents MCP server file
echo "2. Checking cursor-agents MCP server..."
MCP_SERVER="/app/target/cursor-agents/dist/mcp/index.js"
if [ -f "$MCP_SERVER" ]; then
  echo "   ✓ MCP server found at $MCP_SERVER"
  echo "   File size: $(stat -f%z "$MCP_SERVER" 2>/dev/null || stat -c%s "$MCP_SERVER" 2>/dev/null) bytes"
else
  echo "   ✗ MCP server NOT found at $MCP_SERVER"
  echo "   → Build cursor-agents: cd cursor-agents && npm run build"
  exit 1
fi

# 3. Check Redis connectivity
echo "3. Checking Redis connectivity..."
REDIS_URL=$(grep -o '"REDIS_URL"[[:space:]]*:[[:space:]]*"[^"]*"' /root/.cursor/mcp.json 2>/dev/null | sed 's/.*"REDIS_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "redis://redis:6379/0")
REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:]*\):.*|\1|p')
echo "   REDIS_URL from config: $REDIS_URL"
echo "   Redis host: $REDIS_HOST"

if command -v nc >/dev/null 2>&1; then
  if nc -z "$REDIS_HOST" 6379 2>/dev/null; then
    echo "   ✓ Redis is reachable at $REDIS_HOST:6379"
  else
    echo "   ✗ Cannot reach Redis at $REDIS_HOST:6379"
    echo "   → Check Redis container is running and on same network"
  fi
else
  echo "   (nc not available, skipping connectivity test)"
fi

# 4. Test MCP server startup
echo ""
echo "4. Testing MCP server startup..."
export REDIS_URL="$REDIS_URL"
export NODE_ENV="production"

echo "   Starting MCP server with:"
echo "     REDIS_URL=$REDIS_URL"
echo "     NODE_ENV=$NODE_ENV"
echo ""

# Try to start the server and capture output
# MCP server uses stdio, so we'll just test if it starts without crashing
echo "   Testing MCP server startup (will timeout after 3s, which is expected)..."
timeout 3 node "$MCP_SERVER" </dev/null 2>&1 | head -30 || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    echo "   ✓ MCP server started (timeout after 3s is expected for stdio server)"
  else
    echo "   ✗ MCP server failed (exit code: $EXIT_CODE)"
    echo ""
    echo "   Last output:"
    timeout 3 node "$MCP_SERVER" </dev/null 2>&1 | tail -20 || true
    echo ""
    echo "   → Check Redis connection and MCP server logs above"
  fi
}

# 5. Check if cursor-cli can see the config
echo ""
echo "5. Checking cursor-cli MCP config location..."
if command -v cursor >/dev/null 2>&1 || command -v cursor-agent >/dev/null 2>&1; then
  echo "   ✓ cursor-cli is available"
  
  # Check common MCP config locations
  for config_path in "/root/.cursor/mcp.json" "$HOME/.cursor/mcp.json" "/.cursor/mcp.json"; do
    if [ -f "$config_path" ]; then
      echo "   ✓ Found MCP config at: $config_path"
    fi
  done
else
  echo "   ⚠ cursor-cli not found in PATH"
fi

echo ""
echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""
echo "If all checks passed but cursor-cli still can't see tools:"
echo "  1. Restart cursor-cli / Cursor IDE"
echo "  2. Check cursor-cli logs for MCP connection errors"
echo "  3. Verify cursor-cli is reading from /root/.cursor/mcp.json"
echo "  4. Try manually testing MCP server: node $MCP_SERVER"

