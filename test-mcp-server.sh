#!/bin/bash
# Test script to verify cursor-agents MCP server can start and respond to MCP protocol requests

set -e

echo "=== Testing cursor-agents MCP Server ==="
echo ""

MCP_SERVER_PATH="/app/target/cursor-agents/dist/mcp/index.js"

# Check if MCP server file exists
if [ ! -f "$MCP_SERVER_PATH" ]; then
  echo "✗ MCP server not found at $MCP_SERVER_PATH"
  exit 1
fi

echo "✓ MCP server found at $MCP_SERVER_PATH"
echo ""

# Set environment variables
export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="production"

echo "Environment:"
echo "  REDIS_URL: $REDIS_URL"
echo "  NODE_ENV: $NODE_ENV"
echo ""

# Test Redis connectivity
if command -v nc >/dev/null 2>&1; then
  REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:]*\):.*|\1|p')
  if [ -n "$REDIS_HOST" ]; then
    echo "Testing Redis connection to $REDIS_HOST:6379..."
    if nc -z "$REDIS_HOST" 6379 2>/dev/null; then
      echo "✓ Redis is reachable"
    else
      echo "✗ Cannot reach Redis - MCP server will fail to start"
      exit 1
    fi
  fi
fi

echo ""
echo "Starting MCP server test..."
echo "Sending MCP initialize request..."
echo ""

# Create a simple MCP protocol test
# MCP uses JSON-RPC 2.0 over stdio
# We'll send an initialize request and see if we get a response

cat << 'EOF' | timeout 10 node "$MCP_SERVER_PATH" 2>&1 | head -50 || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    echo "✓ MCP server started (timeout expected for stdio server)"
  else
    echo "✗ MCP server failed to start (exit code: $EXIT_CODE)"
    echo ""
    echo "Last output:"
    timeout 5 node "$MCP_SERVER_PATH" 2>&1 | tail -20 || true
    exit 1
  fi
}
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}
EOF

echo ""
echo "=== Test Complete ==="
echo ""
echo "If you see initialization messages above, the MCP server is working."
echo "If you see errors, check:"
echo "  1. Redis is accessible at $REDIS_URL"
echo "  2. cursor-agents is built (dist directory exists)"
echo "  3. All dependencies are installed"

