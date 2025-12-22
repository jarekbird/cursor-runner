#!/bin/bash
# Test script to diagnose Atlassian MCP server connection issues

set -e

echo "=========================================="
echo "Atlassian MCP Server Diagnostic"
echo "=========================================="
echo ""

# 1. Check environment variables
echo "1. Checking Atlassian environment variables..."
if [ -n "$ATLASSIAN_EMAIL" ] && [ -n "$ATLASSIAN_API_TOKEN" ] && [ -n "$ATLASSIAN_CLOUD_ID" ]; then
  echo "   ✓ All required env vars are set"
  echo "   ATLASSIAN_EMAIL: ${ATLASSIAN_EMAIL}"
  echo "   ATLASSIAN_API_TOKEN: ${ATLASSIAN_API_TOKEN:0:20}..."
  echo "   ATLASSIAN_CLOUD_ID: ${ATLASSIAN_CLOUD_ID}"
else
  echo "   ✗ Missing required environment variables"
  echo "   ATLASSIAN_EMAIL: ${ATLASSIAN_EMAIL:-NOT SET}"
  echo "   ATLASSIAN_API_TOKEN: ${ATLASSIAN_API_TOKEN:+SET}${ATLASSIAN_API_TOKEN:-NOT SET}"
  echo "   ATLASSIAN_CLOUD_ID: ${ATLASSIAN_CLOUD_ID:-NOT SET}"
  exit 1
fi
echo ""

# 2. Test npx availability
echo "2. Testing npx availability..."
if command -v npx >/dev/null 2>&1; then
  echo "   ✓ npx is available"
  NPX_VERSION=$(npx --version 2>&1 || echo "unknown")
  echo "   Version: $NPX_VERSION"
else
  echo "   ✗ npx is not available"
  exit 1
fi
echo ""

# 3. Test if we can download/start the atlassian MCP server
echo "3. Testing Atlassian MCP server startup..."
echo "   This will attempt to start the server and check for immediate errors..."
echo ""

export ATLASSIAN_EMAIL="${ATLASSIAN_EMAIL}"
export ATLASSIAN_API_TOKEN="${ATLASSIAN_API_TOKEN}"
export ATLASSIAN_CLOUD_ID="${ATLASSIAN_CLOUD_ID}"

# Try to start the MCP server and capture stderr
# MCP servers use stdio, so we'll send a test message and see if it responds
TEST_OUTPUT=$(timeout 10 sh -c 'echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0\"}}}" | npx -y @modelcontextprotocol/server-atlassian 2>&1' || true)

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo "   ⚠ Server started but timed out (this is expected for stdio servers)"
  echo "   Checking for error messages..."
  if echo "$TEST_OUTPUT" | grep -qi "error\|fail\|invalid\|unauthorized"; then
    echo "   ✗ Found error messages:"
    echo "$TEST_OUTPUT" | grep -i "error\|fail\|invalid\|unauthorized" | head -5
  else
    echo "   ✓ No obvious errors in output"
  fi
elif [ $EXIT_CODE -eq 0 ]; then
  echo "   ✓ Server started successfully"
  echo "   Output:"
  echo "$TEST_OUTPUT" | head -10
else
  echo "   ✗ Server failed to start (exit code: $EXIT_CODE)"
  echo "   Error output:"
  echo "$TEST_OUTPUT" | tail -20
fi
echo ""

# 4. Test network connectivity to Atlassian API
echo "4. Testing network connectivity to Atlassian API..."
if command -v curl >/dev/null 2>&1; then
  # Test basic connectivity (without auth, just to see if we can reach the API)
  if curl -s --max-time 5 "https://api.atlassian.com" >/dev/null 2>&1; then
    echo "   ✓ Can reach Atlassian API"
  else
    echo "   ✗ Cannot reach Atlassian API (network issue?)"
  fi
else
  echo "   (curl not available, skipping connectivity test)"
fi
echo ""

# 5. Check if credentials are valid (basic validation)
echo "5. Validating credentials format..."
if [[ "$ATLASSIAN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
  echo "   ✓ Email format looks valid"
else
  echo "   ⚠ Email format might be invalid: $ATLASSIAN_EMAIL"
fi

if [[ "$ATLASSIAN_API_TOKEN" =~ ^ATATT ]]; then
  echo "   ✓ API token format looks valid (starts with ATATT)"
else
  echo "   ⚠ API token format might be invalid (should start with ATATT)"
fi

if [[ "$ATLASSIAN_CLOUD_ID" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]]; then
  echo "   ✓ Cloud ID format looks valid (UUID format)"
else
  echo "   ⚠ Cloud ID format might be invalid (should be UUID format)"
fi
echo ""

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""
echo "Common issues and solutions:"
echo "  1. If server times out: This is normal for stdio MCP servers"
echo "  2. If server exits immediately: Check credentials and network"
echo "  3. If 'Connection closed' errors: MCP server might be crashing on startup"
echo "  4. If 'Request timed out': MCP server might be slow to respond"
echo ""
echo "Next steps:"
echo "  - Check cursor-cli logs for detailed MCP error messages"
echo "  - Verify credentials are still valid in Atlassian"
echo "  - Check network connectivity from the container"
echo "  - Try manually running: npx -y @modelcontextprotocol/server-atlassian"

