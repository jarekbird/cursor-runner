#!/bin/bash
set -euo pipefail

cd /app/target/cursor-agents || {
  echo "[mcp-server-wrapper] Failed to cd into /app/target/cursor-agents" >&2
  exit 1
}

export REDIS_URL="${REDIS_URL:-redis://redis:6379/0}"
export NODE_ENV="${NODE_ENV:-production}"

echo "[mcp-server-wrapper] Starting MCP server with REDIS_URL=${REDIS_URL}" >&2

exec node dist/mcp/index.js "$@"

