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

# Ensure SSH directory exists and configure GitHub host keys
# This prevents SSH from prompting for host key verification during git operations
if [ ! -d "$HOME/.ssh" ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
fi

# Add GitHub host keys to known_hosts (all key types: rsa, ecdsa, ed25519)
# Remove existing github.com entries first to avoid duplicates
if [ -f "$HOME/.ssh/known_hosts" ]; then
  grep -v "github.com" "$HOME/.ssh/known_hosts" > "$HOME/.ssh/known_hosts.tmp" || true
  mv "$HOME/.ssh/known_hosts.tmp" "$HOME/.ssh/known_hosts" || true
fi

# Scan and add GitHub host keys (non-blocking - continue even if it fails)
if command -v ssh-keyscan >/dev/null 2>&1; then
  echo "Adding GitHub host keys to known_hosts..."
  ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || {
    echo "  ⚠ Warning: Could not add GitHub host keys (ssh-keyscan may have failed)"
    echo "    SSH may prompt for host key verification during git operations"
  }
  chmod 600 "$HOME/.ssh/known_hosts" 2>/dev/null || true
  echo "  ✓ GitHub host keys configured"
else
  echo "  ⚠ Warning: ssh-keyscan not available, cannot pre-configure GitHub host keys"
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

# Verify cursor-agent authentication
# cursor-agent uses CURSOR_API_KEY environment variable automatically if set
# No need to run login command - the API key will be used when cursor-agent runs
if [ -n "$CURSOR_API_KEY" ] && [ "$CURSOR_API_KEY" != "" ]; then
  echo "✓ CURSOR_API_KEY is set"
  if command -v cursor-agent >/dev/null 2>&1; then
    # Verify cursor-agent can see the environment variable
    # Note: cursor-agent will use CURSOR_API_KEY automatically when executing commands
    echo "  cursor-agent will use CURSOR_API_KEY for authentication"
  else
    echo "  ⚠ Warning: cursor-agent command not found"
  fi
else
  echo "⚠ Warning: CURSOR_API_KEY not set or empty"
  echo "  cursor-agent may not be able to authenticate"
  echo "  Set CURSOR_API_KEY in your .env file (it will be loaded by docker-compose.yml)"
  echo "  Example: CURSOR_API_KEY=your-api-key-here"
fi

# Start the application
exec "$@"

