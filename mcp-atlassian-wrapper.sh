#!/usr/bin/env bash
set -euo pipefail

# This wrapper exists to make Atlassian MCP failures diagnosable.
# cursor-agent reports only "Connection closed" when the MCP child exits.
# We tee stderr to a log file so we can see the real root cause.

LOG_FILE="${MCP_ATLASSIAN_STDERR_LOG:-/tmp/mcp-atlassian-stderr.log}"

{
  echo "=================================================="
  echo "atlassian MCP wrapper start: $(date -Is)"
  echo "pwd: $(pwd)"
  echo "node: $(node -v 2>/dev/null || echo 'missing')"
  echo "npx: $(npx --version 2>/dev/null || echo 'missing')"
  echo "ATLASSIAN_EMAIL: ${ATLASSIAN_EMAIL:-<missing>}"
  echo "ATLASSIAN_CLOUD_ID: ${ATLASSIAN_CLOUD_ID:-<missing>}"
  if [ -n "${ATLASSIAN_API_TOKEN:-}" ]; then
    echo "ATLASSIAN_API_TOKEN_LEN: ${#ATLASSIAN_API_TOKEN}"
  else
    echo "ATLASSIAN_API_TOKEN_LEN: 0"
  fi
  echo "=================================================="
} >> "$LOG_FILE"

# Keep stdout/stderr semantics:
# - stdout: MCP protocol stream (must NOT be modified)
# - stderr: duplicated to both cursor-agent stderr and our log file
exec npx -y @modelcontextprotocol/server-atlassian 2> >(tee -a "$LOG_FILE" >&2)


