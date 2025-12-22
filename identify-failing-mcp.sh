#!/bin/bash
# Script to identify which MCP server(s) are failing

set -e

echo "=========================================="
echo "Identifying Failing MCP Servers"
echo "=========================================="
echo ""

MCP_CONFIG="/root/.cursor/mcp.json"

if [ ! -f "$MCP_CONFIG" ]; then
  echo "✗ MCP config not found at $MCP_CONFIG"
  exit 1
fi

echo "✓ MCP config found"
echo ""

# Extract MCP server names from config
echo "Testing each MCP server individually..."
echo ""

# Get list of MCP servers
MCP_SERVERS=$(cat "$MCP_CONFIG" | python3 -c "import sys, json; config = json.load(sys.stdin); print('\n'.join(config.get('mcpServers', {}).keys()))" 2>/dev/null || echo "")

if [ -z "$MCP_SERVERS" ]; then
  echo "✗ Could not extract MCP server names from config"
  exit 1
fi

# Test each server
for SERVER_NAME in $MCP_SERVERS; do
  echo "----------------------------------------"
  echo "Testing: $SERVER_NAME"
  echo "----------------------------------------"
  
  # Extract server config
  SERVER_CONFIG=$(cat "$MCP_CONFIG" | python3 -c "
import sys, json
config = json.load(sys.stdin)
server = config.get('mcpServers', {}).get('$SERVER_NAME', {})
print(json.dumps(server))
" 2>/dev/null)
  
  if [ -z "$SERVER_CONFIG" ]; then
    echo "  ⚠ Could not extract config for $SERVER_NAME"
    continue
  fi
  
  # Extract command and args
  COMMAND=$(echo "$SERVER_CONFIG" | python3 -c "import sys, json; print(json.load(sys.stdin).get('command', ''))" 2>/dev/null)
  ARGS=$(echo "$SERVER_CONFIG" | python3 -c "import sys, json; args = json.load(sys.stdin).get('args', []); print(' '.join([str(a) for a in args]))" 2>/dev/null)
  ENV_VARS=$(echo "$SERVER_CONFIG" | python3 -c "import sys, json; env = json.load(sys.stdin).get('env', {}); [print(f\"export {k}='{v}'\") for k, v in env.items()]" 2>/dev/null)
  
  echo "  Command: $COMMAND"
  echo "  Args: $ARGS"
  if [ -n "$ENV_VARS" ]; then
    echo "  Environment variables:"
    echo "$ENV_VARS" | sed 's/^/    /'
    # Export env vars for testing
    eval "$ENV_VARS"
  fi
  echo ""
  
  # Try to start the server and see if it crashes immediately
  echo "  Testing startup (5 second timeout)..."
  
  TEST_OUTPUT=$(timeout 5 sh -c "echo '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0\"}}}' | $COMMAND $ARGS 2>&1" 2>&1 || true)
  
  EXIT_CODE=$?
  
  if [ $EXIT_CODE -eq 124 ]; then
    echo "  ✓ Server started (timeout is expected for stdio servers)"
    # Check for error messages in output
    if echo "$TEST_OUTPUT" | grep -qi "error\|fail\|invalid\|unauthorized\|crash"; then
      echo "  ⚠ But found error messages:"
      echo "$TEST_OUTPUT" | grep -i "error\|fail\|invalid\|unauthorized\|crash" | head -3 | sed 's/^/    /'
    fi
  elif [ $EXIT_CODE -eq 0 ]; then
    echo "  ✓ Server started successfully"
  else
    echo "  ✗ Server failed (exit code: $EXIT_CODE)"
    if [ -n "$TEST_OUTPUT" ]; then
      echo "  Error output:"
      echo "$TEST_OUTPUT" | tail -10 | sed 's/^/    /'
    fi
  fi
  
  echo ""
done

echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Note: Timeouts are expected for stdio MCP servers."
echo "Look for servers that exit immediately (exit code != 124) or show error messages."

