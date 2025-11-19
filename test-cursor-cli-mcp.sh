#!/bin/bash
# Test if cursor-cli can see and use the cursor-agents MCP server

set -e

echo "=== Testing cursor-cli MCP Connection ==="
echo ""

# Check MCP config
echo "1. Checking MCP configuration..."
if [ -f "/root/.cursor/mcp.json" ]; then
  echo "   ✓ MCP config found at /root/.cursor/mcp.json"
  echo ""
  echo "   cursor-agents config:"
  cat /root/.cursor/mcp.json | grep -A 8 "cursor-agents" || echo "   (not found)"
else
  echo "   ✗ MCP config not found"
  exit 1
fi
echo ""

# Check if cursor-cli is available
echo "2. Checking cursor-cli availability..."
if command -v cursor >/dev/null 2>&1; then
  CURSOR_CMD="cursor"
  echo "   ✓ cursor found: $(which cursor)"
elif command -v cursor-agent >/dev/null 2>&1; then
  CURSOR_CMD="cursor-agent"
  echo "   ✓ cursor-agent found: $(which cursor-agent)"
else
  echo "   ✗ cursor-cli not found in PATH"
  exit 1
fi
echo ""

# Try to get cursor-cli version (this will also test if it works)
echo "3. Testing cursor-cli basic functionality..."
if $CURSOR_CMD --version >/dev/null 2>&1; then
  echo "   ✓ cursor-cli responds to --version"
  VERSION=$($CURSOR_CMD --version 2>&1 | head -1)
  echo "   Version: $VERSION"
else
  echo "   ⚠ cursor-cli --version failed (may still work)"
fi
echo ""

# Check if we can see what MCP servers cursor-cli would use
# (This is tricky - cursor-cli doesn't expose this directly)
echo "4. Note: cursor-cli doesn't expose MCP server status directly"
echo "   To verify MCP servers are working, try using cursor-cli with a prompt"
echo "   that requires MCP tools (like creating an agent)"
echo ""

echo "=== Test Complete ==="
echo ""
echo "If cursor-cli times out when trying to use cursor-agents:"
echo "  1. cursor-cli may not be spawning the MCP server"
echo "  2. The MCP server may be crashing immediately"
echo "  3. There may be a stdio communication issue"
echo ""
echo "To debug further:"
echo "  - Check cursor-cli logs (if available)"
echo "  - Monitor processes during cursor-cli execution"
echo "  - Verify the wrapper script works when run directly"





