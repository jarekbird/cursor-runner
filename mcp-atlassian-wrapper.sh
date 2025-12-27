#!/usr/bin/env bash
set -euo pipefail

# This wrapper exists to make Atlassian MCP failures diagnosable.
# cursor-agent reports only "Connection closed" when the MCP child exits.
# We tee stderr to a log file so we can see the real root cause.

LOG_FILE="${MCP_ATLASSIAN_STDERR_LOG:-/tmp/mcp-atlassian-stderr.log}"

# atlassian-mcp expects:
# - ATLASSIAN_BASE_URL (e.g., https://your-company.atlassian.net)
# - ATLASSIAN_API_TOKEN
# - ATLASSIAN_USERNAME
#
# Our stack historically used ATLASSIAN_EMAIL / ATLASSIAN_CLOUD_ID. We keep them for
# compatibility, but we map email -> username and require base URL explicitly.
if [ -z "${ATLASSIAN_USERNAME:-}" ] && [ -n "${ATLASSIAN_EMAIL:-}" ]; then
  export ATLASSIAN_USERNAME="$ATLASSIAN_EMAIL"
fi

{
  echo "=================================================="
  echo "atlassian MCP wrapper start: $(date -Is)"
  echo "pwd: $(pwd)"
  echo "node: $(node -v 2>/dev/null || echo 'missing')"
  echo "npx: $(npx --version 2>/dev/null || echo 'missing')"
  echo "ATLASSIAN_BASE_URL: ${ATLASSIAN_BASE_URL:-<missing>}"
  echo "ATLASSIAN_USERNAME: ${ATLASSIAN_USERNAME:-<missing>}"
  echo "ATLASSIAN_EMAIL: ${ATLASSIAN_EMAIL:-<missing>}"
  echo "ATLASSIAN_CLOUD_ID: ${ATLASSIAN_CLOUD_ID:-<missing>}"
  if [ -n "${ATLASSIAN_API_TOKEN:-}" ]; then
    echo "ATLASSIAN_API_TOKEN_LEN: ${#ATLASSIAN_API_TOKEN}"
  else
    echo "ATLASSIAN_API_TOKEN_LEN: 0"
  fi
  echo "=================================================="
} >> "$LOG_FILE"

# Hard fail early if base URL is missing; otherwise downstream will emit "Invalid URL"
if [ -z "${ATLASSIAN_BASE_URL:-}" ]; then
  {
    echo "ERROR: ATLASSIAN_BASE_URL is missing."
    echo "atlassian-mcp requires a Jira/Confluence base URL like: https://your-company.atlassian.net"
    echo "Set ATLASSIAN_BASE_URL in cursor-runner environment (docker-compose/.env) and retry."
  } >> "$LOG_FILE" 2>&1
  exit 1
fi

# Prefer already-installed binaries to avoid repeated `npx` downloads and registry checks,
# which can cause heavy disk I/O on small VPS instances.
#
# Fall back to npx ONLY if no binary is available.
{
  echo "Binary availability:"
  echo "  - mcp-server-atlassian: $(command -v mcp-server-atlassian 2>/dev/null || echo '<missing>')"
  echo "  - atlassian-mcp: $(command -v atlassian-mcp 2>/dev/null || echo '<missing>')"
} >> "$LOG_FILE" 2>&1

if command -v mcp-server-atlassian >/dev/null 2>&1; then
  exec mcp-server-atlassian 2> >(tee -a "$LOG_FILE" >&2)
fi

if command -v atlassian-mcp >/dev/null 2>&1; then
  exec atlassian-mcp 2> >(tee -a "$LOG_FILE" >&2)
fi

# Fallback: try known packages without doing `npm view` (which is extra I/O + network).
# Note: This still requires network access the first time (npx install), but avoids the
# preflight registry calls and will use the local npx cache thereafter.
PACKAGE_NAME="${ATLASSIAN_MCP_NPX_PACKAGE:-atlassian-mcp}"
{
  echo "No Atlassian MCP binary found; falling back to npx package: $PACKAGE_NAME"
} >> "$LOG_FILE" 2>&1

exec npx -y "$PACKAGE_NAME" 2> >(tee -a "$LOG_FILE" >&2)



