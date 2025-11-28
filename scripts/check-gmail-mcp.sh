#!/bin/bash
# Script to verify Gmail MCP server is installed and available
# Exits with code 0 if Gmail MCP is available, non-zero if missing

set -e

# Try to get Gmail MCP server version
if command -v mcp-server-gmail >/dev/null 2>&1; then
  # Gmail MCP server is available
  VERSION=$(mcp-server-gmail --version 2>&1 || echo "unknown")
  echo "✓ Gmail MCP server is available (version: $VERSION)"
  exit 0
else
  # Gmail MCP server is not available
  echo "✗ Gmail MCP server not found"
  echo "  Install with: npm install -g @modelcontextprotocol/server-gmail"
  echo "  Or run: npm install (if added to package.json)"
  exit 1
fi

