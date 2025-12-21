#!/bin/bash
# Complete diagnostic script for Atlassian MCP in production
# 
# Usage:
#   docker compose exec cursor-runner bash /tmp/test-atlassian-mcp.sh
#   OR copy to container: docker compose cp test-atlassian-mcp.sh cursor-runner:/tmp/
#
# Run this inside the cursor-runner container

set -e

echo "=========================================="
echo "Atlassian MCP Diagnostic Script"
echo "=========================================="
echo ""

# 1. Environment Variables Check
echo "1. ENVIRONMENT VARIABLES:"
echo "   ENABLE_ATLASSIAN_MCP=${ENABLE_ATLASSIAN_MCP:-NOT SET}"
echo "   ATLASSIAN_EMAIL=${ATLASSIAN_EMAIL:-NOT SET}"
echo "   ATLASSIAN_CLOUD_ID=${ATLASSIAN_CLOUD_ID:-NOT SET}"
if [ -n "$ATLASSIAN_API_TOKEN" ]; then
  echo "   ATLASSIAN_API_TOKEN=SET (length: ${#ATLASSIAN_API_TOKEN})"
else
  echo "   ATLASSIAN_API_TOKEN=NOT SET"
fi
echo "   CURSOR_API_KEY=${CURSOR_API_KEY:+SET}${CURSOR_API_KEY:-NOT SET}"
echo ""

# 2. MCP Config Check
echo "2. MCP CONFIGURATION:"
MCP_CONFIG="/root/.cursor/mcp.json"
if [ -f "$MCP_CONFIG" ]; then
  echo "   ✓ MCP config found at $MCP_CONFIG"
  
  # Check if atlassian entry exists
  if grep -q '"atlassian"' "$MCP_CONFIG"; then
    echo "   ✓ Atlassian entry found in config"
    echo ""
    echo "   Atlassian MCP config:"
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs'); try { const config=JSON.parse(fs.readFileSync('$MCP_CONFIG','utf8')); if(config.mcpServers && config.mcpServers.atlassian) { console.log(JSON.stringify(config.mcpServers.atlassian, null, 2)); } else { console.log('Atlassian not in mcpServers'); } } catch(e) { console.error('Error:', e.message); }"
    elif command -v python3 >/dev/null 2>&1; then
      python3 -c "import json; config=json.load(open('$MCP_CONFIG')); print(json.dumps(config.get('mcpServers', {}).get('atlassian', {}), indent=2))"
    else
      grep -A 10 '"atlassian"' "$MCP_CONFIG"
    fi
  else
    echo "   ✗ Atlassian entry NOT found in config"
    echo ""
    echo "   Current MCP servers in config:"
    if command -v node >/dev/null 2>&1; then
      node -e "const fs=require('fs'); try { const config=JSON.parse(fs.readFileSync('$MCP_CONFIG','utf8')); console.log(Object.keys(config.mcpServers || {}).join(', ')); } catch(e) { console.error('Error:', e.message); }"
    else
      grep -o '"[^"]*":' "$MCP_CONFIG" | tr -d '":' | head -10
    fi
  fi
else
  echo "   ✗ MCP config NOT found at $MCP_CONFIG"
fi
echo ""

# 3. Check merge-mcp-config.js
echo "3. MERGE SCRIPT CHECK:"
MERGE_SCRIPT="/app/merge-mcp-config.js"
if [ -f "$MERGE_SCRIPT" ]; then
  echo "   ✓ merge-mcp-config.js found"
  if grep -q "ENABLE_ATLASSIAN_MCP" "$MERGE_SCRIPT"; then
    echo "   ✓ Atlassian MCP feature flag handling found in script"
  else
    echo "   ✗ Atlassian MCP feature flag handling NOT found in script"
  fi
else
  echo "   ✗ merge-mcp-config.js NOT found"
fi
echo ""

# 4. Check source mcp.json
echo "4. SOURCE MCP.JSON:"
SOURCE_MCP="/app/mcp.json"
if [ -f "$SOURCE_MCP" ]; then
  echo "   ✓ Source mcp.json found at $SOURCE_MCP"
  if grep -q '"atlassian"' "$SOURCE_MCP"; then
    echo "   ✓ Atlassian entry found in source config"
  else
    echo "   ✗ Atlassian entry NOT found in source config"
  fi
else
  echo "   ✗ Source mcp.json NOT found at $SOURCE_MCP"
fi
echo ""

# 5. Test MCP server package availability
echo "5. MCP SERVER PACKAGE:"
if command -v npx >/dev/null 2>&1; then
  echo "   ✓ npx is available"
  echo "   Testing if @modelcontextprotocol/server-atlassian can be downloaded..."
  timeout 10 npx -y @modelcontextprotocol/server-atlassian --version 2>&1 | head -5 || echo "   ⚠ Package download test failed or timed out"
else
  echo "   ✗ npx is NOT available"
fi
echo ""

# 6. Test cursor-agent
echo "6. CURSOR-AGENT TEST:"
if command -v cursor-agent >/dev/null 2>&1; then
  echo "   ✓ cursor-agent is available"
  echo "   Version: $(cursor-agent --version 2>&1 | head -1)"
  echo ""
  if [ -n "$CURSOR_API_KEY" ]; then
    echo "   Testing with Jira query..."
    echo "   Command: cursor-agent --print 'Please give me the details of the Jira Issue: WOR-298'"
    echo ""
    cursor-agent --print "Please give me the details of the Jira Issue: WOR-298" 2>&1 | head -50
  else
    echo "   ⚠ CURSOR_API_KEY not set - cannot test cursor-agent"
    echo "   Set CURSOR_API_KEY to test cursor-agent execution"
  fi
else
  echo "   ✗ cursor-agent is NOT available"
fi
echo ""

# 7. Check recent logs
echo "7. RECENT LOGS (Atlassian-related):"
if [ -f "/app/logs/cursor-runner.log" ]; then
  echo "   Recent Atlassian mentions in logs:"
  tail -100 /app/logs/cursor-runner.log 2>/dev/null | grep -i atlassian | tail -5 || echo "   No Atlassian mentions in recent logs"
else
  echo "   Log file not found at /app/logs/cursor-runner.log"
fi
echo ""

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="

