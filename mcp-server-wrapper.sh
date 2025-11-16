#!/bin/bash
# Wrapper script for cursor-agents MCP server
# This ensures we run from the correct directory and environment variables are set

cd /app/target/cursor-agents || {
  echo "Error: Could not change to /app/target/cursor-agents" >&2
  exit 1
}

# Environment variables should be passed from cursor-cli via the env field in mcp.json
# But we can also set defaults if not provided
export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="${NODE_ENV:-production}"

# Run the MCP server
exec node dist/mcp/index.js

