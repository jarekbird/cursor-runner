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

# Try packages in order of preference (checking Node version compatibility)
PRIMARY_PACKAGE="@modelcontextprotocol/server-atlassian"
FALLBACK_PACKAGE1="atlassian-mcp"  # Works with Node 18
FALLBACK_PACKAGE2="@xuandev/atlassian-mcp"  # Requires Node 20+

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
{
  echo "Node version: $NODE_VERSION"
} >> "$LOG_FILE" 2>&1

# Check if primary package exists
if npm view "$PRIMARY_PACKAGE" version >/dev/null 2>&1; then
  PACKAGE_NAME="$PRIMARY_PACKAGE"
  {
    echo "Using primary package: $PACKAGE_NAME"
  } >> "$LOG_FILE" 2>&1
elif npm view "$FALLBACK_PACKAGE1" version >/dev/null 2>&1; then
  PACKAGE_NAME="$FALLBACK_PACKAGE1"
  {
    echo "Primary package $PRIMARY_PACKAGE not found, using fallback: $PACKAGE_NAME (Node 18 compatible)"
  } >> "$LOG_FILE" 2>&1
elif [ "$NODE_VERSION" -ge 20 ] && npm view "$FALLBACK_PACKAGE2" version >/dev/null 2>&1; then
  PACKAGE_NAME="$FALLBACK_PACKAGE2"
  {
    echo "Using fallback: $PACKAGE_NAME (requires Node 20+)"
  } >> "$LOG_FILE" 2>&1
else
  {
    echo "ERROR: No compatible Atlassian MCP package found"
    echo "Tried: $PRIMARY_PACKAGE, $FALLBACK_PACKAGE1"
    if [ "$NODE_VERSION" -ge 20 ]; then
      echo "Also tried: $FALLBACK_PACKAGE2"
    fi
    echo "This will cause cursor-cli to hang. Exiting immediately."
    echo "To fix: Install an Atlassian MCP package or remove Atlassian MCP from config"
  } >> "$LOG_FILE" 2>&1
  # Exit with code 1 so cursor-cli knows the MCP server failed
  exit 1
fi

# Keep stdout/stderr semantics:
# - stdout: MCP protocol stream (must NOT be modified)
# - stderr: duplicated to both cursor-agent stderr and our log file
exec npx -y "$PACKAGE_NAME" 2> >(tee -a "$LOG_FILE" >&2)



