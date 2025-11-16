#!/bin/bash
set -e

# Run MCP config merge script on startup
# This ensures /root/.cursor/mcp.json is always up to date
if [ -f "/app/merge-mcp-config.js" ]; then
  echo "Running MCP config merge script..."
  node /app/merge-mcp-config.js || {
    echo "Warning: MCP config merge failed, continuing startup..."
  }
else
  echo "Warning: merge-mcp-config.js not found, skipping MCP config merge"
fi

# Verify MCP config exists
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "✓ MCP config found at /root/.cursor/mcp.json"
else
  echo "✗ Warning: MCP config not found at /root/.cursor/mcp.json"
  echo "  cursor-cli may not be able to use MCP connections"
fi

# Verify cursor-agents MCP server file exists
if [ -f "/app/target/cursor-agents/dist/mcp/index.js" ]; then
  echo "✓ cursor-agents MCP server found"
  
  # Test if Redis is accessible (MCP server needs it)
  # Try to get REDIS_URL from MCP config (simple grep, no jq needed)
  REDIS_URL=""
  if [ -f "/root/.cursor/mcp.json" ]; then
    REDIS_URL=$(grep -o '"REDIS_URL"[[:space:]]*:[[:space:]]*"[^"]*"' /root/.cursor/mcp.json 2>/dev/null | sed 's/.*"REDIS_URL"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' || echo "")
  fi
  
  # Fallback to environment variable or default
  REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
  
  if [ -n "$REDIS_URL" ] && [ "$REDIS_URL" != "null" ]; then
    echo "  Testing Redis connectivity for MCP server..."
    echo "  REDIS_URL: $REDIS_URL"
    # Extract host from REDIS_URL (format: redis://host:port/db)
    REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:]*\):.*|\1|p')
    if [ -n "$REDIS_HOST" ] && command -v nc >/dev/null 2>&1; then
      if nc -z "$REDIS_HOST" 6379 2>/dev/null; then
        echo "  ✓ Redis is reachable at $REDIS_HOST:6379"
      else
        echo "  ✗ Warning: Cannot reach Redis at $REDIS_HOST:6379"
        echo "    The cursor-agents MCP server may fail to start"
        echo "    Make sure Redis container is running and on the same network"
      fi
    fi
  else
    echo "  ⚠ Warning: REDIS_URL not found in MCP config"
  fi
else
  echo "✗ Warning: cursor-agents MCP server not found at /app/target/cursor-agents/dist/mcp/index.js"
  echo "  The cursor-agents MCP connection will not work"
fi

# Start the application
exec "$@"

