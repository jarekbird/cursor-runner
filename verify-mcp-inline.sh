#!/bin/bash
# Quick MCP Verification - Run directly on production server
# Usage: Copy and paste these commands, or run: bash <(curl -s ...)

echo "=========================================="
echo "MCP Reliability Verification"
echo "=========================================="
echo ""

# Check 1: /root/.cursor/mcp.json exists
echo "1. Checking /root/.cursor/mcp.json (cursor-cli config)..."
docker exec cursor-runner test -f /root/.cursor/mcp.json && echo "✓ Config exists" || echo "✗ Config missing!"
if docker exec cursor-runner test -f /root/.cursor/mcp.json; then
  echo "  Contents:"
  docker exec cursor-runner cat /root/.cursor/mcp.json | head -20
fi
echo ""

# Check 2: /cursor/mcp.json exists
echo "2. Checking /cursor/mcp.json (persistent volume)..."
docker exec cursor-runner test -f /cursor/mcp.json && echo "✓ Persistent config exists" || echo "⚠ Persistent config missing"
echo ""

# Check 3: /app/mcp.json exists
echo "3. Checking /app/mcp.json (base config)..."
docker exec cursor-runner test -f /app/mcp.json && echo "✓ Base config exists" || echo "✗ Base config missing!"
echo ""

# Check 4: Atlassian MCP configured
echo "4. Checking for Atlassian MCP in config..."
if docker exec cursor-runner test -f /root/.cursor/mcp.json; then
  if docker exec cursor-runner grep -q "atlassian\|Atlassian-MCP-Server" /root/.cursor/mcp.json 2>/dev/null; then
    echo "✓ Atlassian MCP found in config"
  else
    echo "⚠ Atlassian MCP not found in config"
  fi
fi
echo ""

# Check 5: Environment variables
echo "5. Checking Atlassian environment variables..."
docker exec cursor-runner env | grep -i ATLASSIAN || echo "⚠ No Atlassian env vars found"
echo ""

# Check 6: Recent logs
echo "6. Checking recent logs for MCP messages..."
docker logs cursor-runner --tail 100 2>&1 | grep -i "mcp\|atlassian" | tail -5 || echo "  No recent MCP log entries"
echo ""

# Check 7: Check for "don't have access" errors
echo "7. Checking for 'no access' error patterns..."
NO_ACCESS=$(docker logs cursor-runner 2>&1 | grep -i "don't have access\|no access\|cannot access" | wc -l)
if [ "$NO_ACCESS" -eq 0 ]; then
  echo "✓ No 'no access' errors found"
else
  echo "⚠ Found $NO_ACCESS 'no access' errors in logs"
fi
echo ""

echo "=========================================="
echo "Quick Fix: Run merge script if config missing"
echo "=========================================="
echo "If config is missing, run:"
echo "  docker exec cursor-runner node /app/merge-mcp-config.js"
echo ""



