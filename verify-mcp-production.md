# MCP Reliability Verification Checklist

Use this checklist to verify the MCP reliability fixes are working in production.

## 1. Check MCP Config Files Exist

SSH into your production server and verify the config files are in place:

```bash
# Check the merged config (what cursor-cli actually uses)
cat /root/.cursor/mcp.json

# Check the persistent volume config
cat /cursor/mcp.json

# Check the base config in the container
cat /app/mcp.json
```

**Expected Results:**
- `/root/.cursor/mcp.json` should exist and contain merged MCP servers
- Should include `atlassian` (or `Atlassian-MCP-Server`) if enabled
- Should include other MCPs like `cursor-runner-shared-sqlite`, `cursor-runner-shared-redis`, etc.

## 2. Verify Merge Script Ran

Check if the merge script executed successfully:

```bash
# Check cursor-runner logs for merge script execution
docker logs cursor-runner 2>&1 | grep -i "merge\|mcp config"

# Or check startup logs for MCP config verification
docker logs cursor-runner 2>&1 | grep -i "MCP config"
```

**Expected Results:**
- Should see "MCP config found" or "Copied merged config to /root/.cursor/mcp.json"
- Should NOT see "MCP config not found" warnings (unless first startup)

## 3. Test Jira MCP Tool Access

Send a test request through cursor-runner that requires Jira access:

```bash
# Via API (replace with your actual endpoint)
curl -X POST http://your-server:3001/cursor/execute/async \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Get details of Jira issue WOR-161 via MCP",
    "repository": "worksight"
  }'
```

**Or via cursor-runner interface:**
- Send a prompt like: "Get details of Jira issue WOR-161 via MCP"
- The agent should successfully call `mcp_Atlassian-MCP-Server_getJiraIssue`

**Expected Results:**
- Agent should NOT claim "I don't have access to Jira MCP tools"
- Agent should successfully retrieve the issue details
- Check logs for successful MCP tool calls

## 4. Verify Filtered Config Logic

Test that non-Jira prompts don't wipe the MCP config:

```bash
# Send a non-Jira prompt
curl -X POST http://your-server:3001/cursor/execute/async \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "List all files in the repository",
    "repository": "worksight"
  }'

# Immediately after, check if MCP config still exists
cat /root/.cursor/mcp.json
```

**Expected Results:**
- `/root/.cursor/mcp.json` should still exist after non-Jira prompts
- Should NOT be empty or missing MCP servers
- Should contain the full base config (not just selected MCPs)

## 5. Check MCP Selection Logs

Verify MCP selection is working correctly:

```bash
# Check logs for MCP selection
docker logs cursor-runner 2>&1 | grep -i "MCP selection\|selectedMcps"
```

**Expected Results:**
- Should see "MCP selection completed" with `selectedMcps: ["atlassian"]` for Jira prompts
- Should see "MCP selection completed" with appropriate MCPs for other prompts

## 6. Test Startup Self-Healing

Test that the app automatically fixes missing MCP config on startup:

```bash
# Remove the MCP config
docker exec cursor-runner rm /root/.cursor/mcp.json

# Restart the container
docker restart cursor-runner

# Wait a few seconds, then check if config was recreated
docker exec cursor-runner cat /root/.cursor/mcp.json
```

**Expected Results:**
- Config should be automatically recreated on startup
- Should see "Running merge-mcp-config.js" or similar in logs
- `/root/.cursor/mcp.json` should exist after restart

## 7. Verify Environment Variables

Check that required Atlassian env vars are set (if using local atlassian MCP):

```bash
docker exec cursor-runner env | grep -i atlassian
```

**Expected Results:**
- `ATLASSIAN_EMAIL` should be set
- `ATLASSIAN_API_TOKEN` should be set
- `ATLASSIAN_CLOUD_ID` should be set
- `ENABLE_ATLASSIAN_MCP` should be `true` (if using local MCP)

## 8. Test Actual Jira Operations

Send a real Jira operation request:

```bash
curl -X POST http://your-server:3001/cursor/execute/async \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Update Jira issue WOR-161 description to mention AbsencesoftService namespace",
    "repository": "worksight"
  }'
```

**Expected Results:**
- Agent should successfully call Jira MCP tools
- Should NOT claim lack of access
- Operation should complete successfully

## 9. Check for Error Patterns

Look for the old error patterns that should no longer occur:

```bash
# Check for "don't have access" claims
docker logs cursor-runner 2>&1 | grep -i "don't have access\|no access\|cannot access"

# Check for empty MCP config warnings
docker logs cursor-runner 2>&1 | grep -i "empty.*mcp\|mcp.*empty"
```

**Expected Results:**
- Should NOT see "I don't have access to Jira MCP tools" errors
- Should NOT see empty MCP config warnings

## 10. Verify Tool Name Mapping

Check that both naming conventions work:

```bash
# Check what MCP servers are actually configured
docker exec cursor-runner cat /root/.cursor/mcp.json | jq '.mcpServers | keys'
```

**Expected Results:**
- Should see either `atlassian` or `Atlassian-MCP-Server` (or both)
- The code should handle both naming conventions

## Quick Verification Script

Run this quick check script on your production server:

```bash
#!/bin/bash
echo "=== MCP Config Verification ==="
echo ""
echo "1. Checking /root/.cursor/mcp.json..."
if [ -f /root/.cursor/mcp.json ]; then
  echo "✓ Config exists"
  echo "  MCP Servers configured:"
  cat /root/.cursor/mcp.json | jq -r '.mcpServers | keys[]' 2>/dev/null || echo "  (jq not available, but file exists)"
else
  echo "✗ Config missing!"
fi
echo ""
echo "2. Checking /cursor/mcp.json..."
if [ -f /cursor/mcp.json ]; then
  echo "✓ Persistent config exists"
else
  echo "✗ Persistent config missing!"
fi
echo ""
echo "3. Checking recent logs for MCP issues..."
docker logs cursor-runner --tail 100 2>&1 | grep -i "mcp\|atlassian" | tail -5
echo ""
echo "=== Verification Complete ==="
```

## Troubleshooting

If verification fails:

1. **Config missing**: Run `docker exec cursor-runner node /app/merge-mcp-config.js`
2. **Wrong MCP server name**: Check if you're using `atlassian` vs `Atlassian-MCP-Server` and update the selection logic
3. **Feature flag not set**: Ensure `ENABLE_ATLASSIAN_MCP=true` in docker-compose.yml
4. **Env vars missing**: Check that Atlassian credentials are set in environment



