#!/bin/bash
# Test script to verify cursor-agents MCP server can start and connect to Redis

set -e

echo "=== Testing cursor-agents MCP Connection ==="
echo ""

# Check if MCP config exists
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "✓ MCP config found at /root/.cursor/mcp.json"
  echo ""
  echo "MCP Config contents:"
  cat /root/.cursor/mcp.json | jq '.' || cat /root/.cursor/mcp.json
  echo ""
else
  echo "✗ MCP config not found at /root/.cursor/mcp.json"
  exit 1
fi

# Check if cursor-agents MCP server file exists
MCP_SERVER_PATH="/app/target/cursor-agents/dist/mcp/index.js"
if [ -f "$MCP_SERVER_PATH" ]; then
  echo "✓ cursor-agents MCP server found at $MCP_SERVER_PATH"
else
  echo "✗ cursor-agents MCP server not found at $MCP_SERVER_PATH"
  exit 1
fi

# Check Redis connectivity
echo "Testing Redis connection..."
REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
echo "REDIS_URL: $REDIS_URL"

# Extract host and port from Redis URL
if [[ $REDIS_URL =~ redis://([^:]+):([0-9]+) ]]; then
  REDIS_HOST="${BASH_REMATCH[1]}"
  REDIS_PORT="${BASH_REMATCH[2]}"
  echo "Testing connection to Redis at $REDIS_HOST:$REDIS_PORT..."
  
  # Try to connect using nc (netcat) if available
  if command -v nc >/dev/null 2>&1; then
    if nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; then
      echo "✓ Redis is reachable at $REDIS_HOST:$REDIS_PORT"
    else
      echo "✗ Cannot reach Redis at $REDIS_HOST:$REDIS_PORT"
      echo "  Make sure Redis is running and accessible from this container"
      exit 1
    fi
  else
    echo "  (nc not available, skipping connectivity test)"
  fi
else
  echo "  (Could not parse REDIS_URL)"
fi

echo ""

# Test MCP server startup (with timeout)
echo "Testing MCP server startup..."
echo "Running: node $MCP_SERVER_PATH"
echo ""

# Set environment variables from mcp.json
export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="production"

# Try to start the MCP server and see if it initializes
# We'll send it a simple request and see if it responds
timeout 5 node "$MCP_SERVER_PATH" < /dev/null 2>&1 | head -20 || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    echo "✓ MCP server started (timeout after 5s is expected for stdio server)"
  else
    echo "✗ MCP server failed to start (exit code: $EXIT_CODE)"
    echo ""
    echo "Last 20 lines of output:"
    timeout 5 node "$MCP_SERVER_PATH" < /dev/null 2>&1 | tail -20 || true
    exit 1
  fi
}

echo ""
echo "=== Test Complete ==="

