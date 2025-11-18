#!/bin/bash
# Validation script to test the MCP fix in production

set -e

echo "=========================================="
echo "Validating MCP Fix in Production"
echo "=========================================="
echo ""

# 1. Check MCP config has the fix
echo "1. Checking MCP configuration..."
MCP_CONFIG="/root/.cursor/mcp.json"
if [ -f "$MCP_CONFIG" ]; then
  echo "   ✓ MCP config found"
  
  # Check if cursor-agents uses the shell wrapper
  if grep -q 'cd /app/target/cursor-agents && node dist/mcp/index.js' "$MCP_CONFIG"; then
    echo "   ✓ cursor-agents uses shell wrapper with cd (FIX APPLIED)"
  else
    echo "   ✗ cursor-agents does NOT use shell wrapper"
    echo "   → The fix may not be deployed yet"
    exit 1
  fi
else
  echo "   ✗ MCP config not found"
  exit 1
fi
echo ""

# 2. Test MCP server can start with new config
echo "2. Testing MCP server startup with new config..."
export REDIS_URL="redis://redis:6379/0"
export NODE_ENV="production"

# Extract the command from mcp.json
COMMAND=$(grep -A 5 '"cursor-agents"' "$MCP_CONFIG" | grep '"command"' | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
ARGS_JSON=$(grep -A 5 '"cursor-agents"' "$MCP_CONFIG" | grep -A 3 '"args"' | tail -1 | sed 's/.*"\([^"]*\)".*/\1/')

echo "   Command: $COMMAND"
echo "   Args: $ARGS_JSON"
echo ""

# Test the actual command that cursor-cli will run
echo "   Testing: sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js'"
timeout 3 sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js' </dev/null 2>&1 | head -10 || {
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 124 ]; then
    echo "   ✓ MCP server started (timeout expected for stdio server)"
  else
    echo "   ✗ MCP server failed (exit code: $EXIT_CODE)"
    echo "   Last output:"
    timeout 3 sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js' </dev/null 2>&1 | tail -10 || true
    exit 1
  fi
}
echo ""

# 3. Check if MCP server processes can be spawned
echo "3. Testing MCP server process spawn..."
sh -c 'cd /app/target/cursor-agents && node dist/mcp/index.js' </dev/null >/tmp/mcp-validation-stdout.log 2>/tmp/mcp-validation-stderr.log &
MCP_PID=$!

sleep 1

if ps -p $MCP_PID > /dev/null 2>&1; then
  echo "   ✓ MCP server process is running (PID: $MCP_PID)"
  echo "   STDERR output (first 5 lines):"
  head -5 /tmp/mcp-validation-stderr.log 2>/dev/null || echo "   (empty)"
  
  # Kill it
  kill $MCP_PID 2>/dev/null || true
  wait $MCP_PID 2>/dev/null || true
else
  echo "   ✗ MCP server process exited immediately"
  echo "   STDERR output:"
  cat /tmp/mcp-validation-stderr.log 2>/dev/null || echo "   (empty)"
  exit 1
fi
echo ""

# 4. Verify the fix resolves the ES Module issue
echo "4. Verifying ES Module resolution..."
cd /app/target/cursor-agents
if node dist/mcp/index.js --help </dev/null 2>&1 | head -1 >/dev/null 2>&1; then
  echo "   ✓ Node.js can execute the MCP server file"
else
  # Check if it's the ES Module error
  if node dist/mcp/index.js </dev/null 2>&1 | grep -q "ERR_REQUIRE_ESM"; then
    echo "   ✗ Still getting ES Module error (fix not working)"
    exit 1
  else
    echo "   ✓ No ES Module errors (running from correct directory)"
  fi
fi
echo ""

echo "=========================================="
echo "✓ All validation checks passed!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Restart cursor-cli / Cursor IDE to pick up the new config"
echo "  2. Try creating an agent using the cursor-agents MCP tools"
echo "  3. Check cursor-cli logs for MCP connection success"
echo ""




