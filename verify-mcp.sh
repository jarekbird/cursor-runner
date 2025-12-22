#!/bin/bash

# Quick MCP Verification Script
# Run this on your production server to verify MCP reliability fixes

set -e

echo "=========================================="
echo "MCP Reliability Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Check 1: /root/.cursor/mcp.json exists
echo "1. Checking /root/.cursor/mcp.json (cursor-cli config)..."
if [ -f /root/.cursor/mcp.json ]; then
  echo -e "${GREEN}✓${NC} Config exists"
  MCP_COUNT=$(cat /root/.cursor/mcp.json 2>/dev/null | grep -o '"mcpServers"' | wc -l || echo "0")
  if [ "$MCP_COUNT" -gt 0 ]; then
    echo -e "  ${GREEN}✓${NC} Contains mcpServers section"
    echo "  Configured servers:"
    cat /root/.cursor/mcp.json 2>/dev/null | grep -o '"[^"]*":' | grep -v 'mcpServers' | sed 's/://g' | sed 's/"//g' | sed 's/^/    - /' || echo "    (could not parse)"
    ((PASSED++))
  else
    echo -e "${RED}✗${NC} Config exists but appears empty or invalid"
    ((FAILED++))
  fi
else
  echo -e "${RED}✗${NC} Config missing!"
  echo "  Run: docker exec cursor-runner node /app/merge-mcp-config.js"
  ((FAILED++))
fi
echo ""

# Check 2: /cursor/mcp.json exists (persistent volume)
echo "2. Checking /cursor/mcp.json (persistent volume)..."
if [ -f /cursor/mcp.json ]; then
  echo -e "${GREEN}✓${NC} Persistent config exists"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} Persistent config missing (may be first run)"
  echo "  This is OK if merge script will create it"
fi
echo ""

# Check 3: /app/mcp.json exists (base config)
echo "3. Checking /app/mcp.json (base config)..."
if [ -f /app/mcp.json ]; then
  echo -e "${GREEN}✓${NC} Base config exists"
  ((PASSED++))
else
  echo -e "${RED}✗${NC} Base config missing!"
  ((FAILED++))
fi
echo ""

# Check 4: Atlassian MCP configured
echo "4. Checking for Atlassian MCP configuration..."
if [ -f /root/.cursor/mcp.json ]; then
  if grep -q "atlassian\|Atlassian-MCP-Server" /root/.cursor/mcp.json 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Atlassian MCP found in config"
    ((PASSED++))
  else
    echo -e "${YELLOW}⚠${NC} Atlassian MCP not found in config"
    echo "  This may be OK if ENABLE_ATLASSIAN_MCP is not set"
  fi
else
  echo -e "${YELLOW}⚠${NC} Cannot check (config file missing)"
fi
echo ""

# Check 5: Environment variables
echo "5. Checking Atlassian environment variables..."
if [ -n "${ATLASSIAN_EMAIL}" ]; then
  echo -e "${GREEN}✓${NC} ATLASSIAN_EMAIL is set"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} ATLASSIAN_EMAIL not set (may be OK if using remote MCP)"
fi

if [ -n "${ATLASSIAN_API_TOKEN}" ]; then
  echo -e "${GREEN}✓${NC} ATLASSIAN_API_TOKEN is set"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} ATLASSIAN_API_TOKEN not set (may be OK if using remote MCP)"
fi

if [ -n "${ATLASSIAN_CLOUD_ID}" ]; then
  echo -e "${GREEN}✓${NC} ATLASSIAN_CLOUD_ID is set"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} ATLASSIAN_CLOUD_ID not set (may be OK if using remote MCP)"
fi

if [ -n "${ENABLE_ATLASSIAN_MCP}" ]; then
  echo -e "${GREEN}✓${NC} ENABLE_ATLASSIAN_MCP is set: ${ENABLE_ATLASSIAN_MCP}"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} ENABLE_ATLASSIAN_MCP not set (local MCP may be disabled)"
fi
echo ""

# Check 6: Recent logs
echo "6. Checking recent logs for MCP-related messages..."
RECENT_LOGS=$(docker logs cursor-runner --tail 200 2>&1 | grep -i "mcp\|atlassian" | tail -10 || echo "")
if [ -n "$RECENT_LOGS" ]; then
  echo "  Recent MCP log entries:"
  echo "$RECENT_LOGS" | sed 's/^/    /'
  
  # Check for errors
  if echo "$RECENT_LOGS" | grep -qi "error\|fail\|missing\|not found"; then
    echo -e "  ${YELLOW}⚠${NC} Some warnings/errors found in logs"
  else
    echo -e "  ${GREEN}✓${NC} No obvious errors in recent logs"
    ((PASSED++))
  fi
else
  echo -e "  ${YELLOW}⚠${NC} No recent MCP log entries found"
fi
echo ""

# Check 7: Check for "don't have access" errors
echo "7. Checking for 'no access' error patterns..."
NO_ACCESS_COUNT=$(docker logs cursor-runner 2>&1 | grep -i "don't have access\|no access\|cannot access\|I don't have" | wc -l || echo "0")
if [ "$NO_ACCESS_COUNT" -eq 0 ]; then
  echo -e "${GREEN}✓${NC} No 'no access' errors found in logs"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠${NC} Found $NO_ACCESS_COUNT 'no access' errors in logs"
  echo "  This may indicate the fix isn't working yet"
fi
echo ""

# Summary
echo "=========================================="
echo "Verification Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All critical checks passed!${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Send a test Jira request via cursor-runner"
  echo "  2. Verify the agent successfully uses Jira MCP tools"
  echo "  3. Check that non-Jira prompts don't wipe the config"
  exit 0
else
  echo -e "${YELLOW}⚠ Some checks failed. Review the output above.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "  1. If config is missing: docker exec cursor-runner node /app/merge-mcp-config.js"
  echo "  2. Check docker-compose.yml for ENABLE_ATLASSIAN_MCP and env vars"
  echo "  3. Restart cursor-runner: docker restart cursor-runner"
  exit 1
fi


